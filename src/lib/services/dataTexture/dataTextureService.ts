import { DefaultEventEmitter } from '@/lib/events/defaultEventEmitter';
import { ServiceState } from '@/lib/types';
import { createDataTexture } from '@/lib/utils';
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';

/** Cancellation raised when a newer atlas request or teardown supersedes a build. */
export class SequenceAtlasCancelledError extends Error {
  constructor() {
    super('Mesh sequence atlas build was superseded.');
    this.name = 'SequenceAtlasCancelledError';
  }
}

/**
 * DataTextureManager owns per-mesh sampling textures and the currently installed atlas.
 */
export class DataTextureService {
  private textureSize: number;
  private readonly dataTextures = new Map<string, THREE.DataTexture>();
  private readonly eventEmitter: DefaultEventEmitter;
  private currentAtlas: THREE.DataTexture | null = null;
  private serviceState: ServiceState = 'created';
  private sequenceGeneration = 0;
  private cacheGeneration = 0;
  private disposed = false;
  private readonly disposedTextures = new WeakSet<object>();

  constructor(eventEmitter: DefaultEventEmitter, textureSize: number) {
    this.eventEmitter = eventEmitter;
    this.textureSize = textureSize;
    this.updateServiceState('ready');
  }

  setTextureSize(textureSize: number) {
    if (this.disposed || this.textureSize === textureSize) return;

    this.textureSize = textureSize;
    this.cacheGeneration += 1;
    this.invalidatePendingSequence();
    this.clearDataTextures();
    this.disposeCurrentAtlas();
  }

  /**
   * Prepares a mesh for sampling. Results are cached per mesh and texture size.
   */
  async getDataTexture(asset: THREE.Mesh, size: number = this.textureSize): Promise<THREE.DataTexture> {
    this.assertActive();
    const cacheGeneration = this.cacheGeneration;
    return this.getDataTextureAtSize(asset, size, cacheGeneration);
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.sequenceGeneration += 1;
    this.cacheGeneration += 1;
    this.clearDataTextures();
    this.disposeCurrentAtlas();
    this.updateServiceState('disposed');
  }

  /**
   * Invalidates in-flight work when the caller has a newer request that cannot build an atlas.
   * The last installed atlas remains owned until a replacement is ready or the manager is disposed.
   */
  invalidatePendingSequence() {
    if (this.disposed) return;
    this.sequenceGeneration += 1;
    if (this.serviceState === 'loading') this.updateServiceState('ready');
  }

  /**
   * Creates a Texture Atlas containing position data for a sequence of meshes.
   * @param meshes Meshes in the desired sequence order.
   * @param singleTextureSize Resolution of each mesh's data within the atlas.
   * @returns The generated DataTexture atlas, or a cancellation error if superseded.
   */
  async createSequenceDataTextureAtlas(meshes: THREE.Mesh[], singleTextureSize: number): Promise<THREE.DataTexture> {
    this.assertActive();
    const generation = ++this.sequenceGeneration;
    if (meshes.length === 0) {
      this.updateServiceState('error');
      throw new Error('Mesh array cannot be empty.');
    }

    this.updateServiceState('loading');
    const cacheGeneration = this.cacheGeneration;
    const atlasWidth = singleTextureSize * meshes.length;
    const atlasHeight = singleTextureSize;
    const atlasData = new Float32Array(atlasWidth * atlasHeight * 4);

    try {
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        const meshDataTexture = await this.getDataTexture(mesh, singleTextureSize);
        if (this.disposed || cacheGeneration !== this.cacheGeneration) {
          this.disposeTexture(meshDataTexture);
          throw new SequenceAtlasCancelledError();
        }
        this.assertCurrentGeneration(generation);
        const meshTextureData = meshDataTexture.image.data as Float32Array;

        for (let y = 0; y < singleTextureSize; y++) {
          for (let x = 0; x < singleTextureSize; x++) {
            const sourceIndex = (y * singleTextureSize + x) * 4;
            const targetX = x + i * singleTextureSize;
            const targetIndex = (y * atlasWidth + targetX) * 4;

            atlasData[targetIndex] = meshTextureData[sourceIndex];
            atlasData[targetIndex + 1] = meshTextureData[sourceIndex + 1];
            atlasData[targetIndex + 2] = meshTextureData[sourceIndex + 2];
            atlasData[targetIndex + 3] = meshTextureData[sourceIndex + 3];
          }
        }
      }

      this.assertCurrentGeneration(generation);
      const atlasTexture = new THREE.DataTexture(atlasData, atlasWidth, atlasHeight, THREE.RGBAFormat, THREE.FloatType);
      atlasTexture.needsUpdate = true;
      atlasTexture.name = `atlas-${meshes.map((mesh) => mesh.name).join('-')}`;

      const previousAtlas = this.currentAtlas;
      this.currentAtlas = atlasTexture;
      if (previousAtlas) this.disposeTexture(previousAtlas);
      this.updateServiceState('ready');
      return atlasTexture;
    } catch (error) {
      if (this.disposed || generation !== this.sequenceGeneration) throw new SequenceAtlasCancelledError();
      this.updateServiceState('error');
      throw error;
    }
  }

  private async getDataTextureAtSize(asset: THREE.Mesh, size: number, cacheGeneration: number): Promise<THREE.DataTexture> {
    this.assertActive();
    const cacheKey = `${asset.uuid}:${size}`;
    const cachedTexture = this.dataTextures.get(cacheKey);
    if (cachedTexture) return cachedTexture;

    const array = sampleMesh(asset, size);
    const dataTexture = createDataTexture(array, size);
    dataTexture.name = asset.name;

    if (this.disposed || cacheGeneration !== this.cacheGeneration) {
      this.disposeTexture(dataTexture);
      throw new SequenceAtlasCancelledError();
    }

    const racedTexture = this.dataTextures.get(cacheKey);
    if (racedTexture) {
      this.disposeTexture(dataTexture);
      return racedTexture;
    }
    this.dataTextures.set(cacheKey, dataTexture);
    return dataTexture;
  }

  private assertActive() {
    if (this.disposed) throw new SequenceAtlasCancelledError();
  }

  private assertCurrentGeneration(generation: number) {
    if (this.disposed || generation !== this.sequenceGeneration) throw new SequenceAtlasCancelledError();
  }

  private clearDataTextures() {
    const textures = new Set(this.dataTextures.values());
    this.dataTextures.clear();
    textures.forEach((texture) => this.disposeTexture(texture));
  }

  private disposeCurrentAtlas() {
    const atlas = this.currentAtlas;
    this.currentAtlas = null;
    if (atlas) this.disposeTexture(atlas);
  }

  private disposeTexture(texture: THREE.DataTexture) {
    if (this.disposedTextures.has(texture)) return;
    this.disposedTextures.add(texture);
    texture.dispose();
  }

  private updateServiceState(serviceState: ServiceState) {
    this.serviceState = serviceState;
    this.eventEmitter.emit('serviceStateUpdated', { type: 'data-texture', state: serviceState });
  }
}

function sampleMesh(sourceMesh: THREE.Mesh, size: number): Float32Array {
  sourceMesh.updateWorldMatrix(true, false);
  const geometry = sourceMesh.geometry.clone();
  try {
    geometry.applyMatrix4(sourceMesh.matrixWorld);
    const mesh = new THREE.Mesh(geometry);
    const sampler = new MeshSurfaceSampler(mesh).build();
    const data = new Float32Array(size * size * 4);
    const position = new THREE.Vector3();

    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const index = i * size + j;
        sampler.sample(position);
        data[4 * index] = position.x;
        data[4 * index + 1] = position.y;
        data[4 * index + 2] = position.z;
        data[4 * index + 3] = (Math.random() - 0.5) * 0.01;
      }
    }

    return data;
  } finally {
    geometry.dispose();
  }
}
