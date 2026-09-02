import * as THREE from 'three';

/**
 * Creates a new DataTexture from the given data and size.
 * @param data - The data for the texture.
 * @param size - The size of the texture.
 * @returns The created DataTexture.
 */
export function createDataTexture(data: Float32Array, size: number) {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates a blank DataTexture with the given size.
 * @param size - The size of the texture.
 * @returns The created blank DataTexture.
 */
export function createBlankDataTexture(size: number) {
  return createDataTexture(new Float32Array(4 * size * size), size);
}

/**
 * Creates a DataTexture representing a sphere.
 * @param size - The size of the texture.
 * @returns The created DataTexture.
 */
export function createSpherePoints(size: number) {
  const data = new Float32Array(size * size * 4);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const index = i * size + j;

      let theta = Math.random() * Math.PI * 2;
      let phi = Math.acos(Math.random() * 2 - 1);
      let x = Math.sin(phi) * Math.cos(theta);
      let y = Math.sin(phi) * Math.sin(theta);
      let z = Math.cos(phi);

      data[4 * index] = x;
      data[4 * index + 1] = y;
      data[4 * index + 2] = z;
      data[4 * index + 3] = (Math.random() - 0.5) * 0.01;
    }
  }

  return createDataTexture(data, size);
}

export function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose();
  if (mesh.material instanceof THREE.Material) {
    mesh.material.dispose();
  } else {
    mesh.material.forEach((material) => material.dispose());
  }
}

export function clamp(value: number, min: number, max: number): number {
  value = Math.min(value, max);
  value = Math.max(value, min);
  return value;
}
