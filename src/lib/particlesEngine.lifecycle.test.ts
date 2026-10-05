import { DefaultEventEmitter } from '@/lib/events/defaultEventEmitter';
import { EngineState } from '@/lib/types/state';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParticlesEngine } from './particlesEngine';

describe('ParticlesEngine mesh sequence lifecycle', () => {
  afterEach(() => vi.restoreAllMocks());
  it('applies only the latest atlas with its captured mesh count and texture size', async () => {
    const firstMesh = mesh('first-id');
    const secondMesh = mesh('second-id');
    const latestMesh = mesh('latest-id');
    const harness = createHarness({ first: firstMesh, second: secondMesh, latest: latestMesh });

    const oldSetup = harness.engine.setMeshSequence(['first', 'second']);
    const latestSetup = harness.engine.setMeshSequence(['latest']);
    const oldAtlas = texture('old-atlas');
    const latestAtlas = texture('latest-atlas');
    harness.builds[1].resolve(latestAtlas);
    await latestSetup;

    expect(harness.setPositionAtlas).toHaveBeenCalledOnce();
    expect(harness.setPositionAtlas).toHaveBeenCalledWith({
      dataTexture: latestAtlas,
      textureSize: 1,
      numMeshes: 1,
      singleTextureSize: 1,
    });
    expect(harness.internals.meshSequenceAtlasTexture).toBe(latestAtlas);
    expect(harness.internals.engineState.meshSequence).toEqual(['latest']);

    harness.builds[0].resolve(oldAtlas);
    await oldSetup;

    expect(harness.setPositionAtlas).toHaveBeenCalledOnce();
    expect(harness.internals.meshSequenceAtlasTexture).toBe(latestAtlas);
    expect(harness.internals.engineState.meshSequence).toEqual(['latest']);
  });

  it('invalidates pending work when the newest request has no valid mesh IDs', async () => {
    const harness = createHarness({ available: mesh('available') });
    const staleSetup = harness.engine.setMeshSequence(['available']);

    await harness.engine.setMeshSequence(['missing']);
    harness.builds[0].resolve(texture('stale'));
    await staleSetup;

    expect(harness.internals.engineState.meshSequence).toEqual([]);
    expect(harness.setPositionAtlas).not.toHaveBeenCalled();
    expect(harness.setIntersectionSequence).toHaveBeenLastCalledWith([]);
    expect(harness.invalidatePendingSequence).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('preserves partial mesh fallback with debug=%s', async (debug) => {
    const available = mesh('registered-name');
    const harness = createHarness({ validId: available }, debug);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const invalidRequest = vi.fn();
    harness.engine.eventEmitter.on('invalidRequest', invalidRequest);

    const setup = harness.engine.setMeshSequence(['validId', 'missingId']);
    const atlas = texture('partial');
    harness.builds[0].resolve(atlas);
    await setup;

    expect(harness.internals.engineState.meshSequence).toEqual(['validId']);
    expect(harness.setPositionAtlas).toHaveBeenCalledWith({
      dataTexture: atlas,
      textureSize: 1,
      numMeshes: 1,
      singleTextureSize: 1,
    });
    expect(harness.setIntersectionSequence).toHaveBeenCalledWith([available]);
    expect(warn).toHaveBeenCalledTimes(debug ? 1 : 0);
    expect(invalidRequest).toHaveBeenCalledWith({ message: 'Could not find meshes for IDs: missingId' });
  });

  it.each([false, true])('preserves sequence setup failure behavior with debug=%s', async (debug) => {
    const harness = createHarness({ available: mesh('available') }, debug);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const invalidRequest = vi.fn();
    harness.engine.eventEmitter.on('invalidRequest', invalidRequest);
    const failure = new Error('sample failed');
    const setup = harness.engine.setMeshSequence(['available']);
    harness.builds[0].reject(failure);
    await expect(setup).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(debug ? 1 : 0);
    expect(invalidRequest).toHaveBeenCalledWith({ message: 'Failed during mesh sequence setup: Error: sample failed' });
    expect(harness.setPositionAtlas).not.toHaveBeenCalled();
  });

  it('ignores a stale failure without changing the latest requested sequence', async () => {
    const harness = createHarness({ old: mesh('old'), latest: mesh('latest') });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const invalidRequest = vi.fn();
    harness.engine.eventEmitter.on('invalidRequest', invalidRequest);
    const staleSetup = harness.engine.setMeshSequence(['old']);
    const latestSetup = harness.engine.setMeshSequence(['latest']);

    harness.builds[0].reject(new Error('old sample failed'));
    await staleSetup;
    harness.builds[1].resolve(texture('latest'));
    await latestSetup;

    expect(consoleError).not.toHaveBeenCalled();
    expect(invalidRequest).not.toHaveBeenCalled();
    expect(harness.internals.engineState.meshSequence).toEqual(['latest']);
    expect(harness.setPositionAtlas).toHaveBeenCalledOnce();
  });

  it('cancels superseded resizes and restores progress from the newest completed resize', async () => {
    const harness = createHarness({ first: mesh('first'), second: mesh('second') });
    harness.internals.engineState.meshSequence = ['first', 'second'];
    harness.internals.engineState.overallProgress = 0.35;

    const firstResize = harness.engine.setTextureSize(2);
    const secondResize = harness.engine.setTextureSize(3);
    harness.builds[1].resolve(texture('size-three'));
    await secondResize;
    harness.builds[0].resolve(texture('size-two'));
    await firstResize;

    expect(harness.setPositionAtlas).toHaveBeenCalledOnce();
    expect(harness.setPositionAtlas).toHaveBeenCalledWith({
      dataTexture: harness.internals.meshSequenceAtlasTexture,
      textureSize: 3,
      numMeshes: 2,
      singleTextureSize: 3,
    });
    expect(harness.internals.engineState.textureSize).toBe(3);
    expect(harness.internals.engineState.overallProgress).toBe(0.35);
    expect(harness.dataTextureSetSize).toHaveBeenNthCalledWith(1, 2);
    expect(harness.dataTextureSetSize).toHaveBeenNthCalledWith(2, 3);
  });

  it('invalidates pending sequence work on idempotent teardown', async () => {
    const harness = createHarness({ available: mesh('available') });
    const pendingSetup = harness.engine.setMeshSequence(['available']);

    harness.engine.dispose();
    harness.engine.dispose();
    harness.builds[0].resolve(texture('late-atlas'));
    await pendingSetup;

    expect(harness.setPositionAtlas).not.toHaveBeenCalled();
    expect(harness.dataTextureDispose).toHaveBeenCalledOnce();
    expect(harness.assetDispose).toHaveBeenCalledOnce();
    expect(harness.simulationDispose).toHaveBeenCalledOnce();
    expect(harness.internals.meshSequenceAtlasTexture).toBeNull();
  });
});

function createHarness(meshes: Record<string, THREE.Mesh>, debug = false) {
  const engine = Object.create(ParticlesEngine.prototype) as ParticlesEngine;
  const builds: ReturnType<typeof deferred<THREE.DataTexture>>[] = [];
  const setPositionAtlas = vi.fn();
  const setIntersectionSequence = vi.fn();
  const invalidatePendingSequence = vi.fn();
  const dataTextureSetSize = vi.fn();
  const dataTextureDispose = vi.fn();
  const assetDispose = vi.fn();
  const simulationDispose = vi.fn();
  const engineState: EngineState = {
    pointerPosition: { x: 0, y: 0 },
    textureSize: 1,
    meshSequence: [],
    overallProgress: 0,
    velocityTractionForce: 0.1,
    positionalTractionForce: 0.1,
    maxRepelDistance: 0.3,
    textureSequence: [],
    instanceGeometryScale: { x: 1, y: 1, z: 1 },
    useIntersect: true,
  };
  const lifecycleDependencies = {
    dispose: simulationDispose,
    setTextureSize: vi.fn(),
    setPositionAtlas,
    setOverallProgress: vi.fn(),
    setVelocityTractionForce: vi.fn(),
    setPositionalTractionForce: vi.fn(),
    setMaxRepelDistance: vi.fn(),
  };
  const instancedMesh = { parent: {} };
  const scene = { add: vi.fn(), remove: vi.fn() };
  const dataTextureManager = {
    invalidatePendingSequence,
    setTextureSize: dataTextureSetSize,
    createSequenceDataTextureAtlas: vi.fn(() => {
      const build = deferred<THREE.DataTexture>();
      builds.push(build);
      return build.promise;
    }),
    dispose: dataTextureDispose,
  };
  const internals = engine as unknown as {
    assetService: { getMesh: (id: string) => THREE.Mesh | null; dispose: () => void };
    dataTextureManager: typeof dataTextureManager;
    engineState: EngineState;
    eventEmitter: DefaultEventEmitter;
    instancedMeshManager: {
      dispose: () => void;
      getMesh: () => object;
      resize: (size: number) => { current: { parent: object }; previous: { parent: object } };
      setGeometrySize: () => void;
    };
    intersectionService: { dispose: () => void; setMeshSequence: (sequence: THREE.Mesh[]) => void; setOverallProgress: () => void };
    meshSequenceAtlasTexture: THREE.DataTexture | null;
    scene: { add: (object: object) => void; remove: (object: object) => void };
    simulationRendererService: typeof lifecycleDependencies;
    transitionService: { dispose: () => void };
  };
  Object.assign(internals, {
    debug,
    assetService: {
      getMesh: (id: string) => meshes[id] ?? null,
      dispose: assetDispose,
    },
    dataTextureManager,
    disposed: false,
    engineState,
    eventEmitter: new DefaultEventEmitter(),
    instancedMeshManager: {
      dispose: vi.fn(),
      getMesh: () => instancedMesh,
      resize: () => ({ current: instancedMesh, previous: instancedMesh }),
      setGeometrySize: vi.fn(),
    },
    intersectionService: {
      dispose: vi.fn(),
      setMeshSequence: setIntersectionSequence,
      setOverallProgress: vi.fn(),
    },
    meshSequenceAtlasTexture: null,
    meshSequenceGeneration: 0,
    textureSizeGeneration: 0,
    pendingResizeProgress: null,
    scene,
    simulationRendererService: lifecycleDependencies,
    transitionService: { dispose: vi.fn() },
  });
  Object.assign(engine, {
    setOverallProgress: vi.fn((progress: number) => {
      engineState.overallProgress = progress;
    }),
  });

  return {
    engine,
    internals,
    builds,
    setPositionAtlas,
    setIntersectionSequence,
    invalidatePendingSequence,
    dataTextureSetSize,
    dataTextureDispose,
    assetDispose,
    simulationDispose,
  };
}

function mesh(name: string) {
  const result = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  result.name = name;
  return result;
}

function texture(name: string) {
  const result = new THREE.DataTexture(new Float32Array([0, 0, 0, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  result.name = name;
  return result;
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
