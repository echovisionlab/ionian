import * as THREE from 'three';

/** Normalized inputs (-1..1); optional z controls screen-space roll. */
export interface PointerFacingPosition extends THREE.Vector2Like {
  z?: number;
}

export interface PointerFacingOptions {
  /** Disabled by default; independent of particle repulsion. */
  enabled: boolean;
  /** 0 = no tilt, 1 = the full configured tilt. */
  strength: number | THREE.Vector3Like;
  /** Exponential response rate per second; larger values follow faster. */
  response: number | THREE.Vector3Like;
  /** Maximum pitch/yaw/roll in radians at strength 1. Roll defaults to zero. */
  maxAngle: PointerFacingPosition;
}

const DEFAULTS: PointerFacingOptions = {
  enabled: false,
  strength: 1,
  response: 8,
  maxAngle: { x: Math.PI / 9, y: Math.PI / 9, z: 0 },
};

const AXES = ['x', 'y', 'z'] as const;

function validAxes(value: number | THREE.Vector3Like, min: number, max: number, exclusiveMin = false) {
  const valid = (n: number) => Number.isFinite(n) && (exclusiveMin ? n > min : n >= min) && n <= max;
  return typeof value === 'number' ? valid(value) : value != null && AXES.every((axis) => valid(value[axis]));
}

function copyAxes(value: number | THREE.Vector3Like) {
  return typeof value === 'number' ? value : { ...value };
}

function axisValue(value: number | THREE.Vector3Like, axis: keyof THREE.Vector3Like) {
  return typeof value === 'number' ? value : value[axis];
}

/** An outer transform that never overwrites the host's mesh rotation or position. */
export class PointerFacing {
  private options: PointerFacingOptions = { ...DEFAULTS, maxAngle: { ...DEFAULTS.maxAngle } };
  private pointer: THREE.Vector3 | null = null;
  private group: THREE.Group | null = null;
  private target = new THREE.Quaternion();
  private angles = new THREE.Vector3();
  private targetAngles = new THREE.Vector3();
  private cameraFrame = new THREE.Quaternion();
  private parentFrame = new THREE.Quaternion();
  private tilt = new THREE.Euler(0, 0, 0, 'YXZ');
  private inverseTranslation = new THREE.Matrix4();
  private rotationMatrix = new THREE.Matrix4();

  constructor(
    private object: THREE.Object3D,
    private camera?: THREE.Camera,
  ) {}

  setOptions(update: Partial<PointerFacingOptions>) {
    const next = {
      ...this.options,
      ...update,
      strength: copyAxes(update.strength ?? this.options.strength),
      response: copyAxes(update.response ?? this.options.response),
      maxAngle: { ...this.options.maxAngle, ...update.maxAngle },
    };
    if (
      typeof next.enabled !== 'boolean' ||
      !validAxes(next.strength, 0, 1) ||
      !validAxes(next.response, 0, Infinity, true) ||
      !validAxes({ ...next.maxAngle, z: next.maxAngle.z ?? 0 }, 0, Math.PI / 2)
    ) {
      throw new RangeError('Invalid pointer-facing options');
    }
    this.options = next;
    if (next.enabled && !this.group && this.object.parent) {
      const parent = this.object.parent;
      const index = parent.children.indexOf(this.object);
      this.group = new THREE.Group();
      this.group.name = 'ionian-pointer-facing';
      this.group.matrixAutoUpdate = false;
      parent.add(this.group);
      this.group.add(this.object);
      parent.children.splice(parent.children.indexOf(this.group), 1);
      parent.children.splice(index, 0, this.group);
    }
  }

  getOptions(): Readonly<PointerFacingOptions> {
    return { ...this.options, strength: copyAxes(this.options.strength), response: copyAxes(this.options.response), maxAngle: { ...this.options.maxAngle } };
  }

  /** Normalized viewport coordinates. null smoothly returns to neutral. */
  setPointer(position: PointerFacingPosition | null) {
    if (position && (!Number.isFinite(position.x) || !Number.isFinite(position.y) || (position.z !== undefined && !Number.isFinite(position.z)))) {
      throw new RangeError('Pointer coordinates must be finite');
    }
    this.pointer = position
      ? new THREE.Vector3(
          THREE.MathUtils.clamp(position.x, -1, 1),
          THREE.MathUtils.clamp(position.y, -1, 1),
          THREE.MathUtils.clamp(position.z ?? position.x, -1, 1),
        )
      : null;
  }

  replaceObject(object: THREE.Object3D) {
    this.object = object;
    if (this.group && object.parent !== this.group) this.group.add(object);
  }

  update(deltaSeconds: number) {
    if (!this.group) return;
    this.targetAngles.set(0, 0, 0);
    if (this.options.enabled && this.pointer) {
      const { strength, maxAngle } = this.options;
      this.targetAngles.set(
        -this.pointer.y * maxAngle.x * axisValue(strength, 'x'),
        this.pointer.x * maxAngle.y * axisValue(strength, 'y'),
        -this.pointer.z * (maxAngle.z ?? 0) * axisValue(strength, 'z'),
      );
    }
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    for (const axis of AXES) {
      this.angles[axis] += (this.targetAngles[axis] - this.angles[axis]) * -Math.expm1(-axisValue(this.options.response, axis) * dt);
    }
    this.tilt.set(this.angles.x, this.angles.y, this.angles.z, 'YXZ');
    this.target.setFromEuler(this.tilt);
    if (this.camera) {
      this.camera.getWorldQuaternion(this.cameraFrame);
      this.parentFrame.identity();
      this.group.parent?.getWorldQuaternion(this.parentFrame);
      this.cameraFrame.premultiply(this.parentFrame.invert());
      this.target.premultiply(this.cameraFrame).multiply(this.cameraFrame.invert());
    }
    // Rotate about the authored object's position without changing that position.
    const p = this.object.position;
    this.group.matrix
      .makeTranslation(p.x, p.y, p.z)
      .multiply(this.rotationMatrix.makeRotationFromQuaternion(this.target))
      .multiply(this.inverseTranslation.makeTranslation(-p.x, -p.y, -p.z));
    this.group.matrixWorldNeedsUpdate = true;
    this.group.updateWorldMatrix(true, true);
  }

  dispose() {
    if (!this.group) return;
    const parent = this.group.parent;
    if (parent) {
      const index = parent.children.indexOf(this.group);
      parent.add(this.object);
      parent.remove(this.group);
      parent.children.splice(parent.children.indexOf(this.object), 1);
      parent.children.splice(index, 0, this.object);
    } else {
      this.group.remove(this.object);
    }
    this.group = null;
  }
}
