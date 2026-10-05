import { DefaultEventEmitter } from '@/lib/events';
import { ServiceState } from '@/lib/types';
import * as THREE from 'three';
import { DRACOLoader, GLTFLoader } from 'three-stdlib';

const DEFAULT_DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

export interface AssetServiceOptions {
  dracoDecoderPath?: string | null;
  debug?: boolean;
}

export interface LoadMeshOptions {
  meshName?: string;
}

export class AssetService {
  private serviceState: ServiceState = 'created';
  private disposed = false;
  private readonly disposedResources = new WeakSet<object>();

  private readonly eventEmitter;
  private readonly debug: boolean;
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly textures = new Map<string, THREE.Texture>();

  private readonly gltfLoader = new GLTFLoader();
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly dracoLoader: DRACOLoader | null;

  private readonly solidColorTextures = new Map<string, THREE.Texture>();
  private fallbackTexture = new THREE.DataTexture(new Uint8Array([127, 127, 127, 255]), 1, 1, THREE.RGBAFormat);

  constructor(eventEmitter: DefaultEventEmitter, options: AssetServiceOptions = {}) {
    this.eventEmitter = eventEmitter;
    this.debug = options.debug ?? false;
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
    if (this.disposed) {
      disposeAsset(item, this.disposedResources);
      return;
    }

    item.name = id;

    if (item instanceof THREE.Mesh) {
      const prev = this.meshes.get(id);
      if (prev !== item) {
        this.meshes.set(id, item);
        if (prev) this.disposeReplacedAsset(prev);
      }
    } else {
      const prev = this.textures.get(id);
      if (prev !== item) {
        this.textures.set(id, item);
        if (prev) this.disposeReplacedAsset(prev);
      }
    }

    this.eventEmitter.emit('assetRegistered', { id });
  }

  getMesh(id: string): THREE.Mesh | null {
    return this.meshes.get(id) ?? null;
  }

  getMatcapTexture(id: string): THREE.Texture {
    this.assertNotDisposed();
    const texture = this.textures.get(id);
    if (!texture) this.eventEmitter.emit('invalidRequest', { message: `texture with id "${id}" not found. using solid color texture instead...` });
    return texture ?? this.fallbackTexture;
  }

  getSolidColorTexture(colorValue: THREE.ColorRepresentation): THREE.Texture {
    this.assertNotDisposed();
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
      if (this.debug) console.error(`Invalid color value provided to getSolidColorTexture: ${colorValue}`, error);
      this.eventEmitter.emit('invalidRequest', { message: `Invalid color value: ${colorValue}. Using fallback texture.` });
      return this.fallbackTexture;
    }
  }

  getFallbackTexture() {
    this.assertNotDisposed();
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
    if (this.disposed) return null;

    try {
      const gltf = await this.gltfLoader.loadAsync(url);
      if (this.disposed) {
        disposeGltf(gltf, null, this.disposedResources);
        return null;
      }

      const mesh = this.findMesh(gltf.scene, options.meshName);
      if (!mesh) {
        disposeGltf(gltf, null, this.disposedResources, this.collectLiveResources());
        this.eventEmitter.emit('invalidRequest', { message: `failed to load mesh: ${id}. mesh not found` });
        return null;
      }
      disposeGltf(gltf, mesh, this.disposedResources, this.collectLiveResources());
      this.register(id, mesh);
      return mesh;
    } catch (error) {
      if (!this.disposed) this.eventEmitter.emit('invalidRequest', { message: `failed to load mesh: ${id}. ${error}` });
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
    if (this.disposed) return null;

    try {
      const texture = await this.textureLoader.loadAsync(url);
      if (this.disposed) {
        disposeResource(texture, this.disposedResources);
        return null;
      }
      this.register(id, texture);
      return texture;
    } catch (error) {
      if (!this.disposed) this.eventEmitter.emit('invalidRequest', { message: `failed to load texture: ${id}. ${error}` });
      return null;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.updateServiceState('disposed');

    const resources = this.collectLiveResources();
    this.meshes.clear();
    this.textures.clear();
    this.solidColorTextures.clear();
    disposeResources(resources, this.disposedResources);
    this.dracoLoader?.dispose();
  }

  private disposeReplacedAsset(asset: THREE.Mesh | THREE.Texture) {
    const replacedResources = collectAssetResources(asset);
    disposeResources(replacedResources, this.disposedResources, this.collectLiveResources());
  }

  private collectLiveResources(): AssetResources {
    const resources = emptyResources();
    this.meshes.forEach((mesh) => addResources(resources, collectObjectResources(mesh)));
    this.textures.forEach((texture) => resources.textures.add(texture));
    this.solidColorTextures.forEach((texture) => resources.textures.add(texture));
    resources.textures.add(this.fallbackTexture);
    return resources;
  }

  private assertNotDisposed() {
    if (this.disposed) throw new Error('AssetService has been disposed.');
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

interface AssetResources {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
}

function emptyResources(): AssetResources {
  return { geometries: new Set(), materials: new Set(), textures: new Set() };
}

function collectAssetResources(asset: THREE.Mesh | THREE.Texture): AssetResources {
  if (asset instanceof THREE.Texture) return { ...emptyResources(), textures: new Set([asset]) };
  return collectObjectResources(asset);
}

function collectObjectResources(root: THREE.Object3D): AssetResources {
  const resources = emptyResources();
  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
      skeleton?: { boneTexture?: THREE.Texture | null };
    };
    if (renderable.geometry instanceof THREE.BufferGeometry) resources.geometries.add(renderable.geometry);

    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
    for (const material of materials) {
      if (!(material instanceof THREE.Material)) continue;
      resources.materials.add(material);
      Object.values(material).forEach((value) => collectTextureReferences(value, resources.textures));
    }
    if (renderable.skeleton?.boneTexture) resources.textures.add(renderable.skeleton.boneTexture);
  });
  return resources;
}

function collectTextureReferences(value: unknown, textures: Set<THREE.Texture>, seen = new Set<object>()) {
  if (value instanceof THREE.Texture) {
    textures.add(value);
    return;
  }
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectTextureReferences(item, textures, seen));
    return;
  }

  if (Object.getPrototypeOf(value) === Object.prototype) {
    Object.values(value).forEach((item) => collectTextureReferences(item, textures, seen));
  }
}

function addResources(target: AssetResources, source: AssetResources) {
  source.geometries.forEach((geometry) => target.geometries.add(geometry));
  source.materials.forEach((material) => target.materials.add(material));
  source.textures.forEach((texture) => target.textures.add(texture));
}

function disposeResources(resources: AssetResources, disposed: WeakSet<object>, retained: AssetResources = emptyResources()) {
  resources.geometries.forEach((geometry) => {
    if (!retained.geometries.has(geometry)) disposeResource(geometry, disposed);
  });
  resources.materials.forEach((material) => {
    if (!retained.materials.has(material)) disposeResource(material, disposed);
  });
  resources.textures.forEach((texture) => {
    if (!retained.textures.has(texture)) disposeResource(texture, disposed);
  });
}

function disposeAsset(asset: THREE.Mesh | THREE.Texture, disposed: WeakSet<object>) {
  disposeResources(collectAssetResources(asset), disposed);
}

function disposeResource(resource: THREE.BufferGeometry | THREE.Material | THREE.Texture, disposed: WeakSet<object>) {
  if (disposed.has(resource)) return;
  disposed.add(resource);
  resource.dispose();
}

function disposeGltf(
  gltf: { scene: THREE.Group; scenes?: THREE.Group[] },
  selectedMesh: THREE.Mesh | null,
  disposed: WeakSet<object>,
  liveResources: AssetResources = emptyResources(),
) {
  const scenes = Array.from(new Set([...(gltf.scenes ?? []), gltf.scene]));
  const allResources = emptyResources();
  scenes.forEach((scene) => addResources(allResources, collectObjectResources(scene)));

  const retainedResources = emptyResources();
  addResources(retainedResources, liveResources);
  if (selectedMesh) addResources(retainedResources, collectObjectResources(selectedMesh));
  disposeResources(allResources, disposed, retainedResources);
}

function isMesh(object: THREE.Object3D | undefined): object is THREE.Mesh {
  return !!object && 'isMesh' in object && object.isMesh === true;
}
