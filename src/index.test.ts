import { describe, expect, it } from 'vitest';
import { ParticlesEngine, resolveSequenceInterpolation, type ParticlesEngineParameters, type TextureSequence } from './index';

describe('public package surface', () => {
  it('exports the particle engine constructor and sequence helper', () => {
    expect(typeof ParticlesEngine).toBe('function');
    expect(resolveSequenceInterpolation(0.25, 3)).toEqual({ indexA: 0, indexB: 1, localProgress: 0.5 });
  });

  it('keeps the documented public types assignable', () => {
    const sequence: TextureSequence = [
      { type: 'color', value: '#ffffff' },
      { type: 'matcap', id: 'warm' },
    ];
    const params = {
      textureSize: 128,
      dracoDecoderPath: '/draco/',
    } as ParticlesEngineParameters;

    expect(sequence).toHaveLength(2);
    expect(params.textureSize).toBe(128);
    expect(params.dracoDecoderPath).toBe('/draco/');
  });
});
