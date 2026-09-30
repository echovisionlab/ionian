import { DefaultEventEmitter } from '@/lib/events/defaultEventEmitter';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTextureService, SequenceAtlasCancelledError } from './dataTextureService';

describe('DataTextureService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('caches sampling textures by size and clears the cache when resized', async () => {
    const service = new DataTextureService(new DefaultEventEmitter(), 1);
    const source = mesh('cached');
    const first = await service.getDataTexture(source);
    const firstDispose = vi.spyOn(first, 'dispose');

    await expect(service.getDataTexture(source)).resolves.toBe(first);
    expect(first.image.width).toBe(1);

    service.setTextureSize(2);
    expect(firstDispose).toHaveBeenCalledOnce();
    const resized = await service.getDataTexture(source);
    expect(resized).not.toBe(first);
    expect(resized.image.width).toBe(2);

    await service.dispose();
    source.geometry.dispose();
    (source.material as THREE.Material).dispose();
  });

  it('disposes the cloned geometry when sampling fails without a position attribute', async () => {
    const service = new DataTextureService(new DefaultEventEmitter(), 1);
    const sourceGeometry = new THREE.BufferGeometry();
    const clonedGeometry = sourceGeometry.clone();
    const clone = vi.spyOn(sourceGeometry, 'clone').mockReturnValue(clonedGeometry);
    const cloneDispose = vi.spyOn(clonedGeometry, 'dispose');
    const sourceMesh = new THREE.Mesh(sourceGeometry, new THREE.MeshBasicMaterial());

    await expect(service.getDataTexture(sourceMesh)).rejects.toThrow();

    expect(clone).toHaveBeenCalledOnce();
    expect(cloneDispose).toHaveBeenCalledOnce();
    expect((service as unknown as { dataTextures: Map<string, THREE.DataTexture> }).dataTextures.size).toBe(0);
    await service.dispose();
    expect(cloneDispose).toHaveBeenCalledOnce();
    sourceGeometry.dispose();
    (sourceMesh.material as THREE.Material).dispose();
  });

  it('keeps the last requested atlas when overlapping builds complete in reverse order', async () => {
    const service = new DataTextureService(new DefaultEventEmitter(), 1);
    const oldA = mesh('old-a');
    const oldB = mesh('old-b');
    const latestMesh = mesh('latest');
    const pending = new Map([
      ['old-a', deferred<THREE.DataTexture>()],
      ['old-b', deferred<THREE.DataTexture>()],
      ['latest', deferred<THREE.DataTexture>()],
    ]);
    vi.spyOn(service, 'getDataTexture').mockImplementation((source) => pending.get(source.name)!.promise);

    const staleBuild = service.createSequenceDataTextureAtlas([oldA, oldB], 1);
    const latestBuild = service.createSequenceDataTextureAtlas([latestMesh], 1);
    const latestSample = sampleTexture(1, [7, 8, 9, 1]);
    pending.get('latest')!.resolve(latestSample);
    const atlas = await latestBuild;
    const latestAtlasDispose = vi.spyOn(atlas, 'dispose');

    pending.get('old-a')!.resolve(sampleTexture(1, [1, 2, 3, 1]));
    await expect(staleBuild).rejects.toBeInstanceOf(SequenceAtlasCancelledError);

    const testable = service as unknown as { currentAtlas: THREE.DataTexture | null };
    expect(testable.currentAtlas).toBe(atlas);
    expect(atlas.name).toBe('atlas-latest');
    expect(atlas.image.width).toBe(1);
    expect(latestAtlasDispose).not.toHaveBeenCalled();

    await service.dispose();
    expect(latestAtlasDispose).toHaveBeenCalledOnce();
  });

  it('keeps the installed atlas alive until a replacement is ready', async () => {
    const service = new DataTextureService(new DefaultEventEmitter(), 1);
    const previousAtlas = await service.createSequenceDataTextureAtlas([mesh('previous')], 1);
    const previousDispose = vi.spyOn(previousAtlas, 'dispose');
    const pending = deferred<THREE.DataTexture>();
    vi.spyOn(service, 'getDataTexture').mockReturnValue(pending.promise);

    const replacementBuild = service.createSequenceDataTextureAtlas([mesh('replacement')], 1);
    expect(previousDispose).not.toHaveBeenCalled();
    pending.resolve(sampleTexture(1, [4, 5, 6, 1]));
    const replacement = await replacementBuild;

    expect(previousDispose).toHaveBeenCalledOnce();
    expect((service as unknown as { currentAtlas: THREE.DataTexture | null }).currentAtlas).toBe(replacement);
    await service.dispose();
  });

  it('does not let a stale sampling failure replace the latest ready state', async () => {
    const emitter = new DefaultEventEmitter();
    const service = new DataTextureService(emitter, 1);
    const states: string[] = [];
    emitter.on('serviceStateUpdated', ({ type, state }) => {
      if (type === 'data-texture') states.push(state);
    });
    const stale = deferred<THREE.DataTexture>();
    const latest = deferred<THREE.DataTexture>();
    vi.spyOn(service, 'getDataTexture').mockImplementation((source) => (source.name === 'stale' ? stale.promise : latest.promise));

    const staleBuild = service.createSequenceDataTextureAtlas([mesh('stale')], 1);
    const latestBuild = service.createSequenceDataTextureAtlas([mesh('latest')], 1);
    latest.resolve(sampleTexture(1, [3, 4, 5, 1]));
    await latestBuild;
    stale.reject(new Error('late sampling failure'));

    await expect(staleBuild).rejects.toBeInstanceOf(SequenceAtlasCancelledError);
    expect(states.at(-1)).toBe('ready');
    expect(states).not.toContain('error');

    await service.dispose();
  });

  it('invalidates pending sampling on resize and disposes a late cache result once', async () => {
    const service = new DataTextureService(new DefaultEventEmitter(), 1);
    const pending = deferred<THREE.DataTexture>();
    const texture = sampleTexture(1, [1, 1, 1, 1]);
    const dispose = vi.spyOn(texture, 'dispose');
    const getDataTexture = vi.spyOn(service, 'getDataTexture').mockReturnValue(pending.promise);

    const staleBuild = service.createSequenceDataTextureAtlas([mesh('resizing')], 1);
    service.setTextureSize(2);
    pending.resolve(texture);

    await expect(staleBuild).rejects.toBeInstanceOf(SequenceAtlasCancelledError);
    expect(dispose).toHaveBeenCalledOnce();

    await service.dispose();
    getDataTexture.mockRestore();
    await expect(service.getDataTexture(mesh('after-dispose'))).rejects.toBeInstanceOf(SequenceAtlasCancelledError);
  });

  it('invalidates and cleans up pending sampling during teardown', async () => {
    const emitter = new DefaultEventEmitter();
    const service = new DataTextureService(emitter, 1);
    const pending = deferred<THREE.DataTexture>();
    const texture = sampleTexture(1, [1, 2, 3, 1]);
    const dispose = vi.spyOn(texture, 'dispose');
    vi.spyOn(service, 'getDataTexture').mockReturnValue(pending.promise);
    const states: string[] = [];
    emitter.on('serviceStateUpdated', ({ type, state }) => {
      if (type === 'data-texture') states.push(state);
    });

    const build = service.createSequenceDataTextureAtlas([mesh('teardown')], 1);
    await service.dispose();
    await service.dispose();
    pending.resolve(texture);

    await expect(build).rejects.toBeInstanceOf(SequenceAtlasCancelledError);
    expect(dispose).toHaveBeenCalledOnce();
    expect(states.at(-1)).toBe('disposed');
  });

  it('does not allow an invalid newest request to be overwritten by an older failure', async () => {
    const emitter = new DefaultEventEmitter();
    const service = new DataTextureService(emitter, 1);
    const states: string[] = [];
    emitter.on('serviceStateUpdated', ({ type, state }) => {
      if (type === 'data-texture') states.push(state);
    });
    const pending = deferred<THREE.DataTexture>();
    vi.spyOn(service, 'getDataTexture').mockReturnValue(pending.promise);

    const staleBuild = service.createSequenceDataTextureAtlas([mesh('old')], 1);
    await expect(service.createSequenceDataTextureAtlas([], 1)).rejects.toThrow('Mesh array cannot be empty.');
    pending.reject(new Error('stale failure'));

    await expect(staleBuild).rejects.toBeInstanceOf(SequenceAtlasCancelledError);
    expect(states.at(-1)).toBe('error');

    await service.dispose();
  });
});

function mesh(name: string) {
  const result = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  result.name = name;
  return result;
}

function sampleTexture(size: number, data: number[]) {
  return new THREE.DataTexture(new Float32Array(data), size, size, THREE.RGBAFormat, THREE.FloatType);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
