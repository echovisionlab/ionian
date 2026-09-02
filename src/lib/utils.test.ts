import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { clamp, createBlankDataTexture, createDataTexture, createSpherePoints, disposeMesh } from './utils';

describe('utils', () => {
  it('clamps values to the provided range', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(2, 0, 1)).toBe(1);
  });

  it('creates float data textures with the requested size', () => {
    const texture = createDataTexture(new Float32Array(16), 2);

    expect(texture.image.width).toBe(2);
    expect(texture.image.height).toBe(2);
    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(texture.type).toBe(THREE.FloatType);
    expect(texture.image.data).toHaveLength(16);

    texture.dispose();
  });

  it('creates blank and sphere point textures', () => {
    const blank = createBlankDataTexture(2);
    const sphere = createSpherePoints(2);

    expect(blank.image.data).toHaveLength(16);
    expect(Array.from(blank.image.data as Float32Array).every((value) => value === 0)).toBe(true);
    expect(sphere.image.data).toHaveLength(16);

    blank.dispose();
    sphere.dispose();
  });

  it('disposes mesh geometry and materials', () => {
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');

    disposeMesh(mesh);

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it('disposes mesh material arrays', () => {
    const geometry = new THREE.BoxGeometry();
    const materialA = new THREE.MeshBasicMaterial();
    const materialB = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, [materialA, materialB]);
    const materialADispose = vi.spyOn(materialA, 'dispose');
    const materialBDispose = vi.spyOn(materialB, 'dispose');

    disposeMesh(mesh);

    expect(materialADispose).toHaveBeenCalledOnce();
    expect(materialBDispose).toHaveBeenCalledOnce();
  });
});
