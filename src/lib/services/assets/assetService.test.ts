import { DefaultEventEmitter } from '@/lib/events';
import * as THREE from 'three';
import { DRACOLoader, GLTFLoader } from 'three-stdlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetService } from './assetService';

describe('AssetService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not attach a DRACO loader when the decoder path is null', () => {
    const setDRACOLoader = vi.spyOn(GLTFLoader.prototype, 'setDRACOLoader');
    const setDecoderPath = vi.spyOn(DRACOLoader.prototype, 'setDecoderPath');
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });
    const testable = service as unknown as { dracoLoader: DRACOLoader | null };

    expect(testable.dracoLoader).toBeNull();
    expect(setDecoderPath).not.toHaveBeenCalled();
    expect(setDRACOLoader).not.toHaveBeenCalled();

    service.dispose();
  });

  it('registers and replaces mesh assets while disposing the previous mesh', () => {
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });
    const previous = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const next = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial());
    const geometryDispose = vi.spyOn(previous.geometry, 'dispose');
    const materialDispose = vi.spyOn(previous.material, 'dispose');

    service.register('shape', previous);
    service.register('shape', next);

    expect(service.getMesh('shape')).toBe(next);
    expect(service.getMeshIDs()).toEqual(['shape']);
    expect(next.name).toBe('shape');
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();

    service.dispose();
  });

  it('registers and replaces matcap textures while disposing the previous texture', () => {
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });
    const previous = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    const next = new THREE.DataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1, THREE.RGBAFormat);
    const dispose = vi.spyOn(previous, 'dispose');

    service.register('matcap', previous);
    service.register('matcap', next);

    expect(service.getMatcapTexture('matcap')).toBe(next);
    expect(service.getTextureIDs()).toEqual(['matcap']);
    expect(next.name).toBe('matcap');
    expect(dispose).toHaveBeenCalledOnce();

    service.dispose();
  });

  it('returns a cached solid color texture for repeated color values', () => {
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });

    const first = service.getSolidColorTexture('#336699');
    const second = service.getSolidColorTexture(0x336699);

    expect(second).toBe(first);
    expect(first).toBeInstanceOf(THREE.DataTexture);
    const image = (first as THREE.DataTexture).image;
    expect(image.width).toBe(16);
    expect(image.height).toBe(16);

    service.dispose();
  });

  it('uses the fallback texture and emits invalid requests for missing matcaps', () => {
    const emitter = new DefaultEventEmitter();
    const invalidRequest = vi.fn();
    emitter.on('invalidRequest', invalidRequest);
    const service = new AssetService(emitter, { dracoDecoderPath: null });

    const texture = service.getMatcapTexture('missing');

    expect(texture).toBe(service.getFallbackTexture());
    expect(invalidRequest).toHaveBeenCalledWith({
      message: 'texture with id "missing" not found. using solid color texture instead...',
    });

    service.dispose();
  });

  it('loads the first nested mesh from a GLTF scene', async () => {
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    group.add(mesh);
    const scene = new THREE.Group();
    scene.add(group);
    const testable = service as unknown as { gltfLoader: { loadAsync: (url: string) => Promise<{ scene: THREE.Group }> } };
    const loadAsync = vi.spyOn(testable.gltfLoader, 'loadAsync').mockResolvedValue({ scene });

    const loaded = await service.loadMeshAsync('loaded', '/mesh.glb');

    expect(loadAsync).toHaveBeenCalledWith('/mesh.glb');
    expect(loaded).toBe(mesh);
    expect(service.getMesh('loaded')).toBe(mesh);
    expect(mesh.name).toBe('loaded');

    service.dispose();
  });

  it('loads a named mesh from a GLTF scene', async () => {
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.name = 'target';
    const scene = new THREE.Group();
    scene.add(new THREE.Group());
    scene.add(mesh);
    const testable = service as unknown as { gltfLoader: { loadAsync: (url: string) => Promise<{ scene: THREE.Group }> } };
    vi.spyOn(testable.gltfLoader, 'loadAsync').mockResolvedValue({ scene });

    const loaded = await service.loadMeshAsync('loaded', '/mesh.glb', { meshName: 'target' });

    expect(loaded).toBe(mesh);

    service.dispose();
  });

  it('emits invalid requests when a GLTF scene does not contain a mesh', async () => {
    const emitter = new DefaultEventEmitter();
    const invalidRequest = vi.fn();
    emitter.on('invalidRequest', invalidRequest);
    const service = new AssetService(emitter, { dracoDecoderPath: null });
    const testable = service as unknown as { gltfLoader: { loadAsync: (url: string) => Promise<{ scene: THREE.Group }> } };
    vi.spyOn(testable.gltfLoader, 'loadAsync').mockResolvedValue({ scene: new THREE.Group() });

    const loaded = await service.loadMeshAsync('missing', '/mesh.glb');

    expect(loaded).toBeNull();
    expect(invalidRequest).toHaveBeenCalledWith({ message: 'failed to load mesh: missing. mesh not found' });

    service.dispose();
  });

  it('emits invalid requests when GLTF loading fails', async () => {
    const emitter = new DefaultEventEmitter();
    const invalidRequest = vi.fn();
    emitter.on('invalidRequest', invalidRequest);
    const service = new AssetService(emitter, { dracoDecoderPath: null });
    const testable = service as unknown as { gltfLoader: { loadAsync: (url: string) => Promise<{ scene: THREE.Group }> } };
    vi.spyOn(testable.gltfLoader, 'loadAsync').mockRejectedValue(new Error('network'));

    const loaded = await service.loadMeshAsync('broken', '/mesh.glb');

    expect(loaded).toBeNull();
    expect(invalidRequest).toHaveBeenCalledWith({ message: 'failed to load mesh: broken. Error: network' });

    service.dispose();
  });

  it('loads and registers textures', async () => {
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    const testable = service as unknown as { textureLoader: { loadAsync: (url: string) => Promise<THREE.Texture> } };
    const loadAsync = vi.spyOn(testable.textureLoader, 'loadAsync').mockResolvedValue(texture);

    const loaded = await service.loadTextureAsync('texture', '/texture.png');

    expect(loadAsync).toHaveBeenCalledWith('/texture.png');
    expect(loaded).toBe(texture);
    expect(service.getTextures()).toEqual([texture]);

    service.dispose();
  });

  it('emits invalid requests when texture loading fails', async () => {
    const emitter = new DefaultEventEmitter();
    const invalidRequest = vi.fn();
    emitter.on('invalidRequest', invalidRequest);
    const service = new AssetService(emitter, { dracoDecoderPath: null });
    const testable = service as unknown as { textureLoader: { loadAsync: (url: string) => Promise<THREE.Texture> } };
    vi.spyOn(testable.textureLoader, 'loadAsync').mockRejectedValue(new Error('network'));

    const loaded = await service.loadTextureAsync('broken', '/texture.png');

    expect(loaded).toBeNull();
    expect(invalidRequest).toHaveBeenCalledWith({ message: 'failed to load texture: broken. Error: network' });

    service.dispose();
  });
});
