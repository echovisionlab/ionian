import { DefaultEventEmitter } from '@/lib/events';
import { ServiceState } from '@/lib/types';
import { disposeMesh } from '@/lib/utils';
import * as THREE from 'three';
import { DRACOLoader, GLTFLoader } from 'three-stdlib';

const DEFAULT_DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

export interface AssetServiceOptions {
  dracoDecoderPath?: string | null;
}

export interface LoadMeshOptions {
  meshName?: string;
}

export class AssetService {
  private serviceState: ServiceState = 'created';

  private readonly eventEmitter;
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly textures = new Map<string, THREE.Texture>();

  private readonly gltfLoader = new GLTFLoader();
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly dracoLoader: DRACOLoader | null;

  private readonly solidColorTextures = new Map<string, THREE.Texture>();
  private fallbackTexture = new THREE.DataTexture(new Uint8Array([127, 127, 127, 255]), 1, 1, THREE.RGBAFormat);

  constructor(eventEmitter: DefaultEventEmitter, options: AssetServiceOptions = {}) {
    this.eventEmitter = eventEmitter;
    const decoderPath = options.dracoDecoderPath === undefined ? DEFAULT_DRACO_DECODER_PATH : options.dracoDecoderPath;
    if (decoderPath !== null) {
      this.dracoLoader = new DRACOLoader();
      this.dracoLoader.setDecoderPath(decoderPath);
      this.gltfLoader.setDRACOLoader(this.dracoLoader);
    } else {
      this.dracoLoader = null;
    }
    this.fallbackTexture.name = 'default-fallback-texture';
    this.updateServiceState('ready');
  }

  /**
   * Registers an asset.
   * @param id - The ID of the asset.
   * @param item - The asset to set.
   */
  register(id: string, item: THREE.Mesh | THREE.Texture) {
    item.name = id;

    if (item instanceof THREE.Mesh) {
      const prev = this.meshes.get(id);
      if (prev) disposeMesh(prev);
      this.meshes.set(id, item);
    } else {
      const prev = this.textures.get(id);
      if (prev) prev.dispose();
      this.textures.set(id, item);
    }

    this.eventEmitter.emit('assetRegistered', { id });
  }

  getMesh(id: string): THREE.Mesh | null {
    return this.meshes.get(id) ?? null;
  }

  getMatcapTexture(id: string): THREE.Texture {
    const texture = this.textures.get(id);
    if (!texture) this.eventEmitter.emit('invalidRequest', { message: `texture with id "${id}" not found. using solid color texture instead...` });
    return texture ?? this.fallbackTexture;
  }

  getSolidColorTexture(colorValue: THREE.ColorRepresentation): THREE.Texture {
    const colorKey = new THREE.Color(colorValue).getHexString();
    let texture = this.solidColorTextures.get(colorKey);

    if (texture) {
      return texture;
    }

    try {
      const texture = this.createSolidColorDataTexture(new THREE.Color(colorValue));
      this.solidColorTextures.set(colorKey, texture);
      return texture;
    } catch (error) {
      console.error(`Invalid color value provided to getSolidColorTexture: ${colorValue}`, error);
      this.eventEmitter.emit('invalidRequest', { message: `Invalid color value: ${colorValue}. Using fallback texture.` });
      return this.fallbackTexture;
    }
  }

  getFallbackTexture() {
    return this.fallbackTexture;
  }

  getMeshIDs(): string[] {
    return Array.from(this.meshes.keys());
  }

  getTextureIDs(): string[] {
    return Array.from(this.textures.keys());
  }

  getMeshes(): THREE.Mesh[] {
    return Array.from(this.meshes.values());
  }

  getTextures(): THREE.Texture[] {
    return Array.from(this.textures.values());
  }

  private createSolidColorDataTexture(color: THREE.ColorRepresentation, size: number = 16): THREE.DataTexture {
    const col = new THREE.Color(color);
    const width = size;
    const height = size;
    const data = new Uint8Array(width * height * 4); // RGBA

    const r = Math.floor(col.r * 255);
    const g = Math.floor(col.g * 255);
    const b = Math.floor(col.b * 255);

    for (let i = 0; i < width * height; i++) {
      const index = i * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 255; // Alpha
    }

    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.type = THREE.UnsignedByteType;
    texture.wrapS = THREE.RepeatWrapping; // Or ClampToEdgeWrapping
    texture.wrapT = THREE.RepeatWrapping; // Or ClampToEdgeWrapping
    texture.minFilter = THREE.NearestFilter; // Ensure sharp color
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Loads a mesh asynchronously.
   * @param id - The ID of the mesh.
   * @param url - The URL of the mesh.
   * @param options - Optional parameters.
   * @returns The loaded mesh or null.
   */
  async loadMeshAsync(id: string, url: string, options: LoadMeshOptions = {}): Promise<THREE.Mesh | null> {
    try {
      const gltf = await this.gltfLoader.loadAsync(url);
      const mesh = this.findMesh(gltf.scene, options.meshName);
      if (!mesh) {
        this.eventEmitter.emit('invalidRequest', { message: `failed to load mesh: ${id}. mesh not found` });
        return null;
      }
      this.register(id, mesh);
      return mesh;
    } catch (error) {
      this.eventEmitter.emit('invalidRequest', { message: `failed to load mesh: ${id}. ${error}` });
      return null;
    }
  }

  /**
   * Loads a texture asynchronously.
   * @param id - The ID of the texture.
   * @param url - The URL of the texture.
   * @returns The loaded texture or null.
   */
  async loadTextureAsync(id: string, url: string): Promise<THREE.Texture | null> {
    try {
      const texture = await this.textureLoader.loadAsync(url);
      this.register(id, texture);
      return texture;
    } catch (error) {
      this.eventEmitter.emit('invalidRequest', { message: `failed to load texture: ${id}. ${error}` });
      return null;
    }
  }

  dispose() {
    this.updateServiceState('disposed');
    this.meshes.forEach((mesh) => disposeMesh(mesh));
    this.meshes.clear();
    this.textures.forEach((texture) => texture.dispose());
    this.textures.clear();
    this.solidColorTextures.forEach((texture) => texture.dispose());
    this.solidColorTextures.clear();
    this.dracoLoader?.dispose();
    this.fallbackTexture.dispose();
  }

  private updateServiceState(serviceState: ServiceState) {
    this.serviceState = serviceState;
    this.eventEmitter.emit('serviceStateUpdated', { type: 'asset', state: serviceState });
  }

  private findMesh(root: THREE.Object3D, meshName?: string): THREE.Mesh | null {
    if (meshName) {
      const named = root.getObjectByName(meshName);
      return isMesh(named) ? named : null;
    }

    let found: THREE.Mesh | null = null;
    root.traverse((object) => {
      if (!found && isMesh(object)) {
        found = object;
      }
    });
    return found;
  }
}

function isMesh(object: THREE.Object3D | undefined): object is THREE.Mesh {
  return !!object && 'isMesh' in object && object.isMesh === true;
}
