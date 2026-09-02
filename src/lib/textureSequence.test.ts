import { describe, expect, it } from 'vitest';
import { resolveSequenceInterpolation } from './textureSequence';

describe('resolveSequenceInterpolation', () => {
  it('uses the only item for empty or single-item sequences', () => {
    expect(resolveSequenceInterpolation(0.5, 0)).toEqual({ indexA: 0, indexB: 0, localProgress: 0 });
    expect(resolveSequenceInterpolation(0.5, 1)).toEqual({ indexA: 0, indexB: 0, localProgress: 0 });
  });

  it('resolves the active segment and local progress', () => {
    expect(resolveSequenceInterpolation(0, 3)).toEqual({ indexA: 0, indexB: 1, localProgress: 0 });
    expect(resolveSequenceInterpolation(0.25, 3)).toEqual({ indexA: 0, indexB: 1, localProgress: 0.5 });
    expect(resolveSequenceInterpolation(0.5, 3)).toEqual({ indexA: 1, indexB: 2, localProgress: 0 });
    expect(resolveSequenceInterpolation(0.75, 3)).toEqual({ indexA: 1, indexB: 2, localProgress: 0.5 });
  });

  it('clamps progress outside the public 0..1 range', () => {
    expect(resolveSequenceInterpolation(-1, 3)).toEqual({ indexA: 0, indexB: 1, localProgress: 0 });
    expect(resolveSequenceInterpolation(2, 3)).toEqual({ indexA: 2, indexB: 2, localProgress: 1 });
  });
});
