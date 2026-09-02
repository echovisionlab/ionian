import { DefaultEventEmitter } from '@/lib/events/defaultEventEmitter';
import { ServiceState } from '@/lib/types';
import { createDataTexture } from '@/lib/utils';
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';

/**
 * DataTextureManager is responsible for managing data textures used for mesh sampling.
 */
export class DataTextureService {
  private textureSize: number;
  private dataTextures: Map<string, THREE.DataTexture>;
  private eventEmitter;
  private currentAtlas: THREE.DataTexture | null = null; // Cache the current atlas

  /**
   * Creates a new DataTextureManager instance.
   * @param eventEmitter
   * @param textureSize
   */
  constructor(eventEmitter: DefaultEventEmitter, textureSize: number) {
    this.eventEmitter = eventEmitter;
    this.textureSize = textureSize;
    this.dataTextures = new Map<string, THREE.DataTexture>();
    this.updateServiceState('ready');
  }

  setTextureSize(textureSize: number) {
    if (this.textureSize === textureSize) return;
    this.textureSize = textureSize;
    // Clear cache and dispose old textures
    this.dataTextures.forEach((texture) => texture.dispose());
    this.dataTextures.clear();
    if (this.currentAtlas) {
      this.currentAtlas.dispose();
      this.currentAtlas = null;
    }
  }

  /**
   * Prepares a mesh for sampling.
   * @returns The prepared data texture.
   * @param asset The asset to prepare.
   */
  async getDataTexture(asset: THREE.Mesh) {
    const cachedTexture = this.dataTextures.get(asset.uuid); // Use UUID for uniqueness
    if (cachedTexture) {
      return cachedTexture;
    }

    const array = sampleMesh(asset, this.textureSize);
    const dataTexture = createDataTexture(array, this.textureSize);
    dataTexture.name = asset.name; // Keep name for reference
    this.dataTextures.set(asset.uuid, dataTexture); // Cache using UUID
    return dataTexture;
  }

  async dispose() {
    this.dataTextures.forEach((texture) => texture.dispose());
    this.dataTextures.clear();
    if (this.currentAtlas) {
      this.currentAtlas.dispose();
      this.currentAtlas = null;
    }
    this.updateServiceState('disposed');
  }

  private updateServiceState(serviceState: ServiceState) {
    // Debounce or manage state updates if they become too frequent
    this.eventEmitter.emit('serviceStateUpdated', { type: 'data-texture', state: serviceState });
  }

  /**
   * Creates a Texture Atlas containing position data for a sequence of meshes.
   * @param meshes An array of THREE.Mesh objects in the desired sequence.
   * @param singleTextureSize The desired resolution (width/height) for each mesh's data within the atlas.
   * @returns A Promise resolving to the generated DataTexture atlas.
   */
  async createSequenceDataTextureAtlas(meshes: THREE.Mesh[], singleTextureSize: number): Promise<THREE.DataTexture> {
    this.updateServiceState('loading');
    if (this.currentAtlas) {
      this.currentAtlas.dispose(); // Dispose previous atlas
      this.currentAtlas = null;
    }

    const numMeshes = meshes.length;
    if (numMeshes === 0) {
      throw new Error('Mesh array cannot be empty.');
    }

    const atlasWidth = singleTextureSize * numMeshes;
    const atlasHeight = singleTextureSize; // Atlas height should be the height of a single texture
    const atlasData = new Float32Array(atlasWidth * atlasHeight * 4); // Correct size for RGBA Float32Array

    try {
      for (let i = 0; i < numMeshes; i++) {
        const mesh = meshes[i];
        const meshDataTexture = await this.getDataTexture(mesh);
        const meshTextureData = meshDataTexture.image.data as Float32Array;

        for (let y = 0; y < singleTextureSize; y++) {
          for (let x = 0; x < singleTextureSize; x++) {
            const sourceIndex = (y * singleTextureSize + x) * 4;
            const targetX = x + i * singleTextureSize;
            const targetIndex = (y * atlasWidth + targetX) * 4;

            atlasData[targetIndex] = meshTextureData[sourceIndex]; // R (x)
            atlasData[targetIndex + 1] = meshTextureData[sourceIndex + 1]; // G (y)
            atlasData[targetIndex + 2] = meshTextureData[sourceIndex + 2]; // B (z)
            atlasData[targetIndex + 3] = meshTextureData[sourceIndex + 3]; // A (w)
          }
        }
      }

      const atlasTexture = new THREE.DataTexture(atlasData, atlasWidth, atlasHeight, THREE.RGBAFormat, THREE.FloatType);
      atlasTexture.needsUpdate = true; // createDataTexture utility likely sets this, but be explicit
      atlasTexture.name = `atlas-${meshes.map((m) => m.name).join('-')}`;
      this.currentAtlas = atlasTexture; // Cache the new atlas
      this.updateServiceState('ready');
      return atlasTexture;
    } catch (error) {
      this.updateServiceState('error');
      throw error; // Re-throw error for ParticlesEngine to catch
    }
  }
}

function sampleMesh(sourceMesh: THREE.Mesh, size: number): Float32Array {
  sourceMesh.updateWorldMatrix(true, false);
  const geometry = sourceMesh.geometry.clone();
  geometry.applyMatrix4(sourceMesh.matrixWorld);
  const mesh = new THREE.Mesh(geometry);

  const sampler = new MeshSurfaceSampler(mesh).build();
  const data = new Float32Array(size * size * 4);
  const position = new THREE.Vector3();

  try {
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
  } finally {
    geometry.dispose();
  }

  return data;
}
