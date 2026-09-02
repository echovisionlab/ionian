import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { InstancedMeshManager } from './instancedMeshManager';

describe('InstancedMeshManager', () => {
  it('preserves parent order and render state when resizing the mesh', () => {
    const manager = new InstancedMeshManager(2);
    const previous = manager.getMesh();
    const parent = new THREE.Group();
    const before = new THREE.Object3D();
    const after = new THREE.Object3D();
    const userData = { role: 'particles' };

    previous.name = 'particle-field';
    previous.position.set(1, 2, 3);
    previous.quaternion.setFromEuler(new THREE.Euler(0.1, 0.2, 0.3));
    previous.scale.set(4, 5, 6);
    previous.updateMatrix();
    previous.updateMatrixWorld(true);
    previous.visible = false;
    previous.castShadow = true;
    previous.receiveShadow = true;
    previous.frustumCulled = false;
    previous.renderOrder = 7;
    previous.layers.set(3);
    previous.userData = userData;
    parent.add(before, previous, after);

    const { current } = manager.resize(4);

    expect(current).not.toBe(previous);
    expect(manager.getMesh()).toBe(current);
    expect(current.count).toBe(16);
    expect(parent.children).toEqual([before, current, after]);
    expect(current.parent).toBe(parent);
    expect(previous.parent).toBeNull();
    expect(current.name).toBe('particle-field');
    expect(current.position.toArray()).toEqual([1, 2, 3]);
    expect(current.quaternion.toArray()).toEqual(previous.quaternion.toArray());
    expect(current.scale.toArray()).toEqual([4, 5, 6]);
    expect(current.matrix.elements).toEqual(previous.matrix.elements);
    expect(current.visible).toBe(false);
    expect(current.castShadow).toBe(true);
    expect(current.receiveShadow).toBe(true);
    expect(current.frustumCulled).toBe(false);
    expect(current.renderOrder).toBe(7);
    expect(current.layers.mask).toBe(previous.layers.mask);
    expect(current.userData).toBe(userData);

    current.dispose();
    previous.dispose();
    manager.dispose();
  });
});
