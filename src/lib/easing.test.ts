import { describe, expect, it } from 'vitest';
import { linear } from './easing';

describe('linear', () => {
  it('returns the input progress unchanged', () => {
    expect(linear(0)).toBe(0);
    expect(linear(0.5)).toBe(0.5);
    expect(linear(1)).toBe(1);
  });
});
