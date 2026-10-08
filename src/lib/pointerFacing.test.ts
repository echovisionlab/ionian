import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PointerFacing } from './pointerFacing';

function fixture() {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh();
  mesh.position.set(2, 1, -1);
  mesh.rotation.set(0.2, 0.3, 0.4);
  scene.add(mesh);
  return { scene, mesh, facing: new PointerFacing(mesh, new THREE.PerspectiveCamera()) };
}

describe('pointer facing', () => {
  it('preserves the default scene structure and authored rotation', () => {
    const { scene, mesh, facing } = fixture();
    const authored = mesh.quaternion.clone();
    facing.setPointer({ x: 1, y: 1 });
    facing.update(1);
    expect(mesh.parent).toBe(scene);
    expect(mesh.quaternion.equals(authored)).toBe(true);
  });

  it('composes an outer tilt with independently changing mesh rotation without orbiting its position', () => {
    const { mesh, facing } = fixture();
    facing.setOptions({ enabled: true, strength: 0.5, response: 8, maxAngle: { x: 0.4, y: 0.6 } });
    facing.setPointer({ x: 1, y: 1 });
    mesh.rotation.z += 0.5;
    const authored = mesh.quaternion.clone();
    facing.update(10);
    expect(mesh.quaternion.equals(authored)).toBe(true);
    expect(mesh.getWorldPosition(new THREE.Vector3()).distanceTo(mesh.position)).toBeLessThan(1e-10);
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.3, 0, 'YXZ'));
    expect(mesh.getWorldQuaternion(new THREE.Quaternion()).angleTo(tilt.multiply(authored))).toBeLessThan(1e-7);
  });

  it('has the same response after one second at 30 and 120 fps', () => {
    const a = fixture();
    const b = fixture();
    for (const { facing } of [a, b]) {
      facing.setOptions({ enabled: true, response: 2 });
      facing.setPointer({ x: 0.8, y: -0.7 });
    }
    for (let i = 0; i < 30; i++) a.facing.update(1 / 30);
    for (let i = 0; i < 120; i++) b.facing.update(1 / 120);
    expect(a.mesh.getWorldQuaternion(new THREE.Quaternion()).angleTo(b.mesh.getWorldQuaternion(new THREE.Quaternion()))).toBeLessThan(1e-6);
  });

  it('returns to neutral on leave, strength zero or disable; teardown restores the original hierarchy', () => {
    const { scene, mesh, facing } = fixture();
    facing.setOptions({ enabled: true });
    facing.setPointer({ x: 1, y: 1 });
    facing.update(1);
    facing.setPointer(null);
    facing.update(10);
    expect(mesh.getWorldQuaternion(new THREE.Quaternion()).angleTo(mesh.quaternion)).toBeLessThan(1e-7);
    facing.setPointer({ x: 1, y: 1 });
    facing.setOptions({ strength: 0 });
    facing.update(10);
    expect(mesh.getWorldQuaternion(new THREE.Quaternion()).angleTo(mesh.quaternion)).toBeLessThan(1e-7);
    facing.setOptions({ enabled: false });
    facing.update(10);
    facing.dispose();
    facing.dispose();
    expect(scene.children).toEqual([mesh]);
  });

  it('retains pointer-facing after the rendered mesh is replaced', () => {
    const { mesh, facing } = fixture();
    facing.setOptions({ enabled: true });
    const replacement = mesh.clone();
    mesh.parent!.add(replacement);
    mesh.removeFromParent();
    facing.replaceObject(replacement);
    facing.setPointer({ x: 1, y: 0 });
    facing.update(1);
    expect(replacement.getWorldQuaternion(new THREE.Quaternion()).angleTo(replacement.quaternion)).toBeGreaterThan(0.1);
  });

  it('controls strength and response independently on all rotation axes', () => {
    const { mesh, facing } = fixture();
    mesh.rotation.set(0, 0, 0);
    facing.setOptions({
      enabled: true,
      strength: { x: 0.5, y: 1, z: 0.25 },
      response: { x: 1, y: 8, z: 2 },
      maxAngle: { x: 0.4, y: 0.6, z: 0.8 },
    });
    facing.setPointer({ x: 1, y: 1, z: -1 });
    facing.update(0.5);
    const actual = new THREE.Euler().setFromQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
    expect(actual.x).toBeCloseTo(-0.2 * (1 - Math.exp(-0.5)), 10);
    expect(actual.y).toBeCloseTo(0.6 * (1 - Math.exp(-4)), 10);
    expect(actual.z).toBeCloseTo(0.2 * (1 - Math.exp(-1)), 10);
  });

  it('allows any axis to be disabled and maps horizontal pointer motion to optional roll', () => {
    const { mesh, facing } = fixture();
    mesh.rotation.set(0, 0, 0);
    facing.setOptions({ enabled: true, strength: { x: 0, y: 0, z: 1 }, maxAngle: { x: 1, y: 1, z: 0.4 } });
    facing.setPointer({ x: 0.5, y: 1 });
    facing.update(10);
    const actual = new THREE.Euler().setFromQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
    expect(actual.x).toBeCloseTo(0, 10);
    expect(actual.y).toBeCloseTo(0, 10);
    expect(actual.z).toBeCloseTo(-0.2, 10);
    facing.setPointer(null);
    facing.update(10);
    expect(mesh.getWorldQuaternion(new THREE.Quaternion()).angleTo(mesh.quaternion)).toBeLessThan(1e-7);
  });

  it('keeps axis-specific response independent of frame rate, including roll', () => {
    const a = fixture();
    const b = fixture();
    for (const { facing } of [a, b]) {
      facing.setOptions({ enabled: true, response: { x: 1, y: 4, z: 8 }, maxAngle: { x: 0.4, y: 0.5, z: 0.2 } });
      facing.setPointer({ x: 0.8, y: -0.7, z: 0.4 });
    }
    for (let i = 0; i < 30; i++) a.facing.update(1 / 30);
    for (let i = 0; i < 120; i++) b.facing.update(1 / 120);
    expect(a.mesh.getWorldQuaternion(new THREE.Quaternion()).angleTo(b.mesh.getWorldQuaternion(new THREE.Quaternion()))).toBeLessThan(1e-6);
  });

  it('follows the camera screen axes under a rotated parent without moving the authored position', () => {
    const { scene, mesh } = fixture();
    const parent = new THREE.Group();
    parent.rotation.set(0.2, 0.4, -0.3);
    scene.add(parent);
    parent.add(mesh);
    const camera = new THREE.PerspectiveCamera();
    camera.rotation.z = Math.PI / 2;
    const authored = mesh.quaternion.clone();
    const position = mesh.getWorldPosition(new THREE.Vector3());
    const facing = new PointerFacing(mesh, camera);
    facing.setOptions({ enabled: true, maxAngle: { x: 0.2, y: 0.3, z: 0.1 } });
    facing.setPointer({ x: 1, y: 1, z: 1 });
    facing.update(10);
    const cameraRotation = camera.getWorldQuaternion(new THREE.Quaternion());
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.3, -0.1, 'YXZ'));
    const expected = cameraRotation
      .clone()
      .multiply(tilt)
      .multiply(cameraRotation.clone().invert())
      .multiply(parent.getWorldQuaternion(new THREE.Quaternion()))
      .multiply(authored);
    expect(mesh.getWorldQuaternion(new THREE.Quaternion()).angleTo(expected)).toBeLessThan(1e-6);
    expect(mesh.getWorldPosition(new THREE.Vector3()).distanceTo(position)).toBeLessThan(1e-10);
  });

  it('copies vector settings so host changes and returned options cannot mutate the controller', () => {
    const { facing } = fixture();
    const strength = { x: 0.5, y: 0.7, z: 0.2 };
    facing.setOptions({ strength });
    strength.x = 1;
    const options = facing.getOptions();
    (options.strength as { x: number; y: number; z: number }).y = 0;
    expect(facing.getOptions().strength).toEqual({ x: 0.5, y: 0.7, z: 0.2 });
  });

  it('rejects invalid values without corrupting the last settings', () => {
    const { facing } = fixture();
    expect(() => facing.setOptions({ strength: NaN })).toThrow(RangeError);
    expect(() => facing.setOptions({ response: 0 })).toThrow(RangeError);
    expect(() => facing.setOptions({ maxAngle: { x: Infinity, y: 1 } })).toThrow(RangeError);
    expect(() => facing.setOptions({ maxAngle: { x: 1, y: 1, z: NaN } })).toThrow(RangeError);
    expect(() => facing.setOptions({ strength: { x: 0.5, y: 0.5, z: 1.1 } })).toThrow(RangeError);
    expect(() => facing.setOptions({ response: { x: 2, y: 0, z: 4 } })).toThrow(RangeError);
    expect(() => facing.setPointer({ x: NaN, y: 0 })).toThrow(RangeError);
    expect(() => facing.setPointer({ x: 0, y: 0, z: Infinity })).toThrow(RangeError);
    expect(facing.getOptions().strength).toBe(1);
  });
});
