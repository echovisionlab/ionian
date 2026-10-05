import { DefaultEventEmitter } from '@/lib/events';
import { ParticlesEngine } from '@/lib/particlesEngine';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulationRendererService } from './simulationRendererService';

const gpu = vi.hoisted(() => ({ initError: null as string | null }));
vi.mock('three/examples/jsm/misc/GPUComputationRenderer.js', () => ({
  GPUComputationRenderer: class {
    addVariable() {
      return { material: { uniforms: {} } };
    }
    setVariableDependencies() {}
    init() {
      return gpu.initError;
    }
    getCurrentRenderTarget() {
      return { texture: {} };
    }
    dispose() {}
  },
}));

describe('simulation diagnostic options', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    gpu.initError = null;
  });

  const renderer = { capabilities: { isWebGL2: true }, debug: { checkShaderErrors: true } } as THREE.WebGLRenderer;

  it.each([undefined, true])('keeps diagnostics debug=%s through texture resize and preserves invalidRequest', (debug) => {
    const emitter = new DefaultEventEmitter();
    const invalidRequest = vi.fn();
    emitter.on('invalidRequest', invalidRequest);
    const service = new SimulationRendererService(emitter, 1, renderer, debug);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const atlas = new THREE.DataTexture(new Float32Array(8), 1, 2);
    const entry = { dataTexture: atlas, numMeshes: 1, singleTextureSize: 1, textureSize: 1 };

    service.setPositionAtlas(entry);
    service.setTextureSize(2);
    service.setPositionAtlas(entry);
    expect(error).toHaveBeenCalledTimes(debug ? 2 : 0);
    service.setPositionAtlas({ ...entry, numMeshes: 2 });
    expect(invalidRequest).toHaveBeenCalledWith({ message: 'Atlas texture width mismatch.' });
    service.dispose();
    atlas.dispose();
  });

  it.each([undefined, true])('threads engine debug=%s to intersection diagnostics without changing the host renderer', async (debug) => {
    const engine = new ParticlesEngine({ textureSize: 1, scene: new THREE.Scene(), renderer, debug });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const invalidRequest = vi.fn();
    engine.eventEmitter.on('invalidRequest', invalidRequest);
    await engine.setMeshSequence(['missing']);
    expect(invalidRequest).toHaveBeenCalledWith({ message: 'Could not find meshes for IDs: missing' });
    expect(warn).toHaveBeenCalledTimes(debug ? 1 : 0);
    const testable = engine as unknown as { intersectionService: { setMeshSequence: (meshes: THREE.Mesh[]) => void } };
    testable.intersectionService.setMeshSequence([null as unknown as THREE.Mesh]);
    expect(warn).toHaveBeenCalledTimes(debug ? 2 : 0);
    expect(renderer.debug.checkShaderErrors).toBe(true);
    engine.dispose();
  });

  it('still throws GPU initialization errors with diagnostics disabled', () => {
    gpu.initError = 'unsupported GPU';
    expect(() => new SimulationRendererService(new DefaultEventEmitter(), 1, renderer)).toThrow('Failed to initialize SimulationRenderer: unsupported GPU');
  });
});
