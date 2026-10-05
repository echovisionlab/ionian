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

  it.each([undefined, true])('preserves color fallback and invalidRequest with debug=%s', (debug) => {
    const emitter = new DefaultEventEmitter();
    const invalidRequest = vi.fn();
    emitter.on('invalidRequest', invalidRequest);
    const service = new AssetService(emitter, { dracoDecoderPath: null, debug });
    const testable = service as unknown as { createSolidColorDataTexture: (color: THREE.Color) => THREE.Texture };
    vi.spyOn(testable, 'createSolidColorDataTexture').mockImplementation(() => {
      throw new Error('texture allocation failed');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(service.getSolidColorTexture('#336699')).toBe(service.getFallbackTexture());
    expect(invalidRequest).toHaveBeenCalledWith({ message: 'Invalid color value: #336699. Using fallback texture.' });
    expect(error).toHaveBeenCalledTimes(debug ? 1 : 0);
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

  it('disposes a texture that finishes loading after teardown without registering it', async () => {
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    const dispose = vi.spyOn(texture, 'dispose');
    const pending = deferred<THREE.Texture>();
    const testable = service as unknown as { textureLoader: { loadAsync: (url: string) => Promise<THREE.Texture> } };
    vi.spyOn(testable.textureLoader, 'loadAsync').mockReturnValue(pending.promise);

    const load = service.loadTextureAsync('late', '/late.png');
    service.dispose();
    service.dispose();
    pending.resolve(texture);

    await expect(load).resolves.toBeNull();
    expect(service.getTextureIDs()).toEqual([]);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('disposes every unique resource from a GLTF completed after teardown', async () => {
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });
    const pending = deferred<{ scene: THREE.Group }>();
    const testable = service as unknown as { gltfLoader: { loadAsync: (url: string) => Promise<{ scene: THREE.Group }> } };
    vi.spyOn(testable.gltfLoader, 'loadAsync').mockReturnValue(pending.promise);

    const sharedGeometry = new THREE.BoxGeometry();
    const sharedTexture = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    const sharedMaterial = new THREE.MeshBasicMaterial({ map: sharedTexture });
    const extraGeometry = new THREE.SphereGeometry();
    const extraMaterial = new THREE.MeshBasicMaterial();
    const geometryDispose = vi.spyOn(sharedGeometry, 'dispose');
    const textureDispose = vi.spyOn(sharedTexture, 'dispose');
    const materialDispose = vi.spyOn(sharedMaterial, 'dispose');
    const extraGeometryDispose = vi.spyOn(extraGeometry, 'dispose');
    const extraMaterialDispose = vi.spyOn(extraMaterial, 'dispose');
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(sharedGeometry, sharedMaterial));
    scene.add(new THREE.Mesh(sharedGeometry, sharedMaterial));
    scene.add(new THREE.Mesh(extraGeometry, extraMaterial));

    const load = service.loadMeshAsync('late', '/late.glb');
    service.dispose();
    pending.resolve({ scene });

    await expect(load).resolves.toBeNull();
    expect(service.getMeshIDs()).toEqual([]);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(extraGeometryDispose).toHaveBeenCalledOnce();
    expect(extraMaterialDispose).toHaveBeenCalledOnce();
  });

  it('disposes discarded GLTF resources while preserving shared resources used by the selected mesh', async () => {
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });
    const sharedGeometry = new THREE.BoxGeometry();
    const sharedTexture = new THREE.DataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1, THREE.RGBAFormat);
    const sharedMaterial = new THREE.MeshBasicMaterial({ map: sharedTexture });
    const selectedChildGeometry = new THREE.TorusGeometry();
    const selectedChildMaterial = new THREE.MeshBasicMaterial();
    const discardedGeometry = new THREE.SphereGeometry();
    const discardedMaterial = new THREE.MeshBasicMaterial();
    const otherSceneGeometry = new THREE.ConeGeometry();
    const otherSceneMaterial = new THREE.MeshBasicMaterial();
    const sharedGeometryDispose = vi.spyOn(sharedGeometry, 'dispose');
    const sharedTextureDispose = vi.spyOn(sharedTexture, 'dispose');
    const sharedMaterialDispose = vi.spyOn(sharedMaterial, 'dispose');
    const selectedChildGeometryDispose = vi.spyOn(selectedChildGeometry, 'dispose');
    const selectedChildMaterialDispose = vi.spyOn(selectedChildMaterial, 'dispose');
    const discardedGeometryDispose = vi.spyOn(discardedGeometry, 'dispose');
    const discardedMaterialDispose = vi.spyOn(discardedMaterial, 'dispose');
    const otherSceneGeometryDispose = vi.spyOn(otherSceneGeometry, 'dispose');
    const otherSceneMaterialDispose = vi.spyOn(otherSceneMaterial, 'dispose');
    const scene = new THREE.Group();
    const branch = new THREE.Group();
    const selected = new THREE.Mesh(sharedGeometry, sharedMaterial);
    selected.name = 'selected';
    selected.add(new THREE.Mesh(selectedChildGeometry, selectedChildMaterial));
    const sharedSibling = new THREE.Mesh(sharedGeometry, sharedMaterial);
    const discardedSibling = new THREE.Mesh(discardedGeometry, discardedMaterial);
    branch.add(selected);
    branch.add(sharedSibling);
    branch.add(discardedSibling);
    scene.add(branch);
    const secondScene = new THREE.Group();
    secondScene.add(new THREE.Mesh(otherSceneGeometry, otherSceneMaterial));
    const testable = service as unknown as { gltfLoader: { loadAsync: (url: string) => Promise<{ scene: THREE.Group; scenes: THREE.Group[] }> } };
    vi.spyOn(testable.gltfLoader, 'loadAsync').mockResolvedValue({ scene, scenes: [scene, secondScene] });

    await expect(service.loadMeshAsync('selected-id', '/model.glb', { meshName: 'selected' })).resolves.toBe(selected);

    expect(branch.children).toEqual([selected, sharedSibling, discardedSibling]);
    expect(selected.children).toHaveLength(1);
    expect(sharedGeometryDispose).not.toHaveBeenCalled();
    expect(sharedTextureDispose).not.toHaveBeenCalled();
    expect(sharedMaterialDispose).not.toHaveBeenCalled();
    expect(selectedChildGeometryDispose).not.toHaveBeenCalled();
    expect(selectedChildMaterialDispose).not.toHaveBeenCalled();
    expect(discardedGeometryDispose).toHaveBeenCalledOnce();
    expect(discardedMaterialDispose).toHaveBeenCalledOnce();
    expect(otherSceneGeometryDispose).toHaveBeenCalledOnce();
    expect(otherSceneMaterialDispose).toHaveBeenCalledOnce();

    service.dispose();
    expect(sharedGeometryDispose).toHaveBeenCalledOnce();
    expect(sharedTextureDispose).toHaveBeenCalledOnce();
    expect(sharedMaterialDispose).toHaveBeenCalledOnce();
    expect(selectedChildGeometryDispose).toHaveBeenCalledOnce();
    expect(selectedChildMaterialDispose).toHaveBeenCalledOnce();
  });

  it('preserves a SkinnedMesh bone hierarchy in sibling scene nodes', async () => {
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });
    const scene = new THREE.Group();
    const armature = new THREE.Bone();
    const joint = new THREE.Bone();
    armature.name = 'armature';
    joint.name = 'joint';
    armature.add(joint);
    const skinnedMesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    skinnedMesh.name = 'skin';
    skinnedMesh.bind(new THREE.Skeleton([armature, joint]));
    scene.add(armature);
    scene.add(skinnedMesh);
    const testable = service as unknown as { gltfLoader: { loadAsync: (url: string) => Promise<{ scene: THREE.Group }> } };
    vi.spyOn(testable.gltfLoader, 'loadAsync').mockResolvedValue({ scene });

    await expect(service.loadMeshAsync('skin-id', '/skin.glb')).resolves.toBe(skinnedMesh);

    expect(scene.children).toEqual([armature, skinnedMesh]);
    expect(armature.parent).toBe(scene);
    expect(joint.parent).toBe(armature);
    expect(skinnedMesh.skeleton.bones).toEqual([armature, joint]);

    service.dispose();
  });

  it('does not dispose GLTF resources shared with an already registered mesh', async () => {
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });
    const sharedGeometry = new THREE.BoxGeometry();
    const sharedTexture = new THREE.DataTexture(new Uint8Array([12, 34, 56, 255]), 1, 1, THREE.RGBAFormat);
    const sharedMaterial = new THREE.MeshBasicMaterial({ map: sharedTexture });
    const sharedGeometryDispose = vi.spyOn(sharedGeometry, 'dispose');
    const sharedTextureDispose = vi.spyOn(sharedTexture, 'dispose');
    const sharedMaterialDispose = vi.spyOn(sharedMaterial, 'dispose');
    const liveMesh = new THREE.Mesh(sharedGeometry, sharedMaterial);
    const selected = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial());
    selected.name = 'selected';
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(sharedGeometry, sharedMaterial));
    scene.add(selected);
    service.register('live', liveMesh);
    const testable = service as unknown as { gltfLoader: { loadAsync: (url: string) => Promise<{ scene: THREE.Group }> } };
    vi.spyOn(testable.gltfLoader, 'loadAsync').mockResolvedValue({ scene });

    await expect(service.loadMeshAsync('selected', '/shared.glb', { meshName: 'selected' })).resolves.toBe(selected);

    expect(sharedGeometryDispose).not.toHaveBeenCalled();
    expect(sharedTextureDispose).not.toHaveBeenCalled();
    expect(sharedMaterialDispose).not.toHaveBeenCalled();

    service.dispose();
    expect(sharedGeometryDispose).toHaveBeenCalledOnce();
    expect(sharedTextureDispose).toHaveBeenCalledOnce();
    expect(sharedMaterialDispose).toHaveBeenCalledOnce();
  });

  it('preserves live asset resources while discarding a GLTF with no matching mesh', async () => {
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });
    const sharedTexture = new THREE.DataTexture(new Uint8Array([12, 34, 56, 255]), 1, 1, THREE.RGBAFormat);
    const liveTextureDispose = vi.spyOn(sharedTexture, 'dispose');
    service.register('live-texture', sharedTexture);
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: sharedTexture })));
    const testable = service as unknown as { gltfLoader: { loadAsync: (url: string) => Promise<{ scene: THREE.Group }> } };
    vi.spyOn(testable.gltfLoader, 'loadAsync').mockResolvedValue({ scene });

    await expect(service.loadMeshAsync('missing', '/shared-texture.glb', { meshName: 'missing' })).resolves.toBeNull();

    expect(liveTextureDispose).not.toHaveBeenCalled();
    expect(service.getTextureIDs()).toEqual(['live-texture']);
    service.dispose();
    expect(liveTextureDispose).toHaveBeenCalledOnce();
  });

  it('does not acquire synchronous assets after disposal', () => {
    const service = new AssetService(new DefaultEventEmitter(), { dracoDecoderPath: null });
    service.dispose();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');

    service.register('late', mesh);

    expect(service.getMeshIDs()).toEqual([]);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(() => service.getSolidColorTexture('#ffffff')).toThrow('AssetService has been disposed.');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
