import { DefaultEventEmitter, EngineEventEmitter, Events } from '@/lib/events';
import * as THREE from 'three';

/**
 * Service for calculating intersections between a ray and a morphed geometry.
 */
export class IntersectionService {
  private active: boolean = true;

  private raycaster = new THREE.Raycaster();
  private mousePosition = new THREE.Vector2();

  private camera?: THREE.Camera;

  private meshSequenceGeometries: THREE.BufferGeometry[] = [];
  private meshSequenceUUIDs: string[] = [];

  private overallProgress: number = 0;
  private intersectionMesh = new THREE.Mesh(); // Use a single mesh for intersection target

  private geometryNeedsUpdate: boolean;
  private eventEmitter: EngineEventEmitter<Events>;

  private blendedGeometry?: THREE.BufferGeometry; // Keep for the final blended result
  private intersection?: THREE.Vector4;

  /**
   * Creates a new IntersectionService instance.
   * @param eventEmitter The event emitter used for emitting events.
   * @param camera The camera used for raycasting.
   */
  constructor(eventEmitter: DefaultEventEmitter, camera?: THREE.Camera) {
    this.camera = camera;
    this.eventEmitter = eventEmitter;
    this.geometryNeedsUpdate = true;
  }

  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      // Clear intersection when deactivated
      this.intersection = undefined;
      this.eventEmitter.emit('interactionPositionUpdated', { position: { x: 0, y: 0, z: 0, w: 0 } });
    }
  }

  getIntersectionMesh(): THREE.Mesh {
    return this.intersectionMesh;
  }

  /**
   * Set the camera used for raycasting.
   * @param camera
   */
  setCamera(camera: THREE.Camera) {
    this.camera = camera;
  }

  /**
   * Sets the sequence of meshes used for intersection calculations.
   * Clones the geometries to avoid modifying originals.
   * @param meshes An array of THREE.Mesh objects in sequence.
   */
  setMeshSequence(meshes: THREE.Mesh[]) {
    // Dispose old geometries
    this.meshSequenceGeometries.forEach((geom) => geom.dispose());
    this.meshSequenceGeometries = [];
    this.meshSequenceUUIDs = [];

    if (!meshes || meshes.length === 0) {
      this.geometryNeedsUpdate = true; // Need update to potentially clear geometry
      return;
    }

    meshes.forEach((mesh) => {
      if (mesh && mesh.geometry) {
        const clonedGeometry = mesh.geometry.clone();
        // IMPORTANT: Apply the mesh's world matrix to the cloned geometry
        // so the intersection calculation uses world coordinates.
        clonedGeometry.applyMatrix4(mesh.matrixWorld);
        this.meshSequenceGeometries.push(clonedGeometry);
        this.meshSequenceUUIDs.push(mesh.uuid); // Store UUID for reference
      } else {
        console.warn('Invalid mesh provided to IntersectionService sequence.');
        // Add a placeholder or handle error? For now, just skip.
      }
    });
    this.geometryNeedsUpdate = true; // Geometry has changed
  }

  /**
   * Set the overall progress through the mesh sequence.
   * @param progress Value between 0.0 (first mesh) and 1.0 (last mesh).
   */
  setOverallProgress(progress: number) {
    const newProgress = THREE.MathUtils.clamp(progress, 0.0, 1.0);
    if (this.overallProgress !== newProgress) {
      this.overallProgress = newProgress;
      this.geometryNeedsUpdate = true; // Progress change requires geometry update
    }
  }

  /**
   * Set the mouse position.
   * @param mousePosition
   */
  setPointerPosition(mousePosition?: THREE.Vector2Like) {
    if (mousePosition) this.mousePosition.copy(mousePosition);
  }

  /**
   * Calculate the intersection.
   * @returns The intersection point or undefined if no intersection was found.
   */
  calculate(instancedMesh: THREE.Mesh): THREE.Vector4 | undefined {
    if (!this.active || !this.camera || this.meshSequenceGeometries.length === 0) {
      // If inactive or no camera/geometry, ensure no intersection is reported
      if (this.intersection) {
        // Only emit update if state changes
        this.intersection = undefined;
        this.eventEmitter.emit('interactionPositionUpdated', { position: { x: 0, y: 0, z: 0, w: 0 } });
      }
      return undefined;
    }

    if (this.geometryNeedsUpdate) {
      // Dispose previous blended geometry before creating a new one
      if (this.blendedGeometry && this.blendedGeometry !== this.intersectionMesh.geometry) {
        this.blendedGeometry.dispose();
      }
      this.blendedGeometry = this.getBlendedGeometry(); // Calculate the new blended geometry
      this.geometryNeedsUpdate = false; // Mark as updated

      // Update the mesh used for raycasting
      if (this.blendedGeometry) {
        // Only replace geometry if it's different to avoid unnecessary disposal
        if (this.intersectionMesh.geometry !== this.blendedGeometry) {
          if (this.intersectionMesh.geometry) this.intersectionMesh.geometry.dispose(); // Dispose old one first
          this.intersectionMesh.geometry = this.blendedGeometry;
        }
      } else {
        // If no blended geometry, clear the intersection mesh's geometry
        if (this.intersectionMesh.geometry) this.intersectionMesh.geometry.dispose();
        this.intersectionMesh.geometry = new THREE.BufferGeometry(); // Empty geometry
      }
    }

    // Ensure the intersection mesh's world matrix matches the instanced mesh
    // This is crucial if the instanced mesh itself moves or rotates
    this.intersectionMesh.matrixWorld.copy(instancedMesh.matrixWorld);

    let newIntersection: THREE.Vector4 | undefined = undefined;
    if (this.blendedGeometry && this.blendedGeometry.attributes.position) {
      // Check if geometry is valid
      newIntersection = this.getFirstIntersection(this.camera, this.intersectionMesh); // Use intersectionMesh now
    }

    // Only emit update if intersection state changes
    const hasChanged =
      this.intersection?.x !== newIntersection?.x ||
      this.intersection?.y !== newIntersection?.y ||
      this.intersection?.z !== newIntersection?.z ||
      (this.intersection && !newIntersection) ||
      (!this.intersection && newIntersection);

    if (hasChanged) {
      this.intersection = newIntersection;
      if (this.intersection) {
        // Convert world intersection point to the instanced mesh's local space
        const worldPoint = new THREE.Vector3(this.intersection.x, this.intersection.y, this.intersection.z);
        const localPoint = instancedMesh.worldToLocal(worldPoint.clone()); // Use clone
        this.intersection.set(localPoint.x, localPoint.y, localPoint.z, 1); // w=1 indicates intersection found

        this.eventEmitter.emit('interactionPositionUpdated', { position: this.intersection });
      } else {
        this.eventEmitter.emit('interactionPositionUpdated', { position: { x: 0, y: 0, z: 0, w: 0 } }); // w=0 indicates no intersection
      }
    }

    return this.intersection; // Return the local space intersection vector
  }

  /**
   * Dispose the resources used by the IntersectionService.
   */
  dispose() {
    this.meshSequenceGeometries.forEach((geom) => geom.dispose());
    this.meshSequenceGeometries = [];
    this.meshSequenceUUIDs = [];
    if (this.blendedGeometry && this.blendedGeometry !== this.intersectionMesh.geometry) {
      this.blendedGeometry.dispose();
    }
    this.intersectionMesh.geometry?.dispose(); // Dispose geometry held by intersectionMesh
  }

  private updateIntersectionMesh(instancedMesh: THREE.Mesh) {
    if (this.blendedGeometry) {
      if (this.blendedGeometry.uuid !== this.intersectionMesh.geometry.uuid) {
        this.intersectionMesh.geometry.dispose();
        this.intersectionMesh.geometry = this.blendedGeometry;
      }
    }
    this.intersectionMesh.matrix.copy(instancedMesh.matrixWorld);
    this.intersectionMesh.matrixWorld.copy(instancedMesh.matrixWorld);
    this.intersectionMesh.matrixAutoUpdate = false;
    this.intersectionMesh.updateMatrixWorld(true);
  }

  private getFirstIntersection(camera: THREE.Camera, targetMesh: THREE.Mesh): THREE.Vector4 | undefined {
    this.raycaster.setFromCamera(this.mousePosition, camera);

    // Intersect with the provided target mesh (which should have the blended geometry)
    const intersects = this.raycaster.intersectObject(targetMesh, false);

    if (intersects.length > 0 && intersects[0].point) {
      const worldPoint = intersects[0].point;
      // Return world point here, conversion to local happens in calculate()
      return new THREE.Vector4(worldPoint.x, worldPoint.y, worldPoint.z, 1);
    }
    return undefined;
  }

  private getBlendedGeometry(): THREE.BufferGeometry | undefined {
    const numGeometries = this.meshSequenceGeometries.length;
    if (numGeometries === 0) {
      return undefined;
    }
    if (numGeometries === 1) {
      return this.meshSequenceGeometries[0]; // No blending needed
    }

    // Calculate which two geometries to blend and the local progress
    const totalSegments = numGeometries - 1;
    const progressPerSegment = 1.0 / totalSegments;
    const scaledProgress = this.overallProgress * totalSegments;

    let indexA = Math.floor(scaledProgress);
    let indexB = indexA + 1;

    // Clamp indices to be within bounds
    indexA = THREE.MathUtils.clamp(indexA, 0, totalSegments);
    indexB = THREE.MathUtils.clamp(indexB, 0, totalSegments);

    // Calculate local progress between indexA and indexB
    // Avoid division by zero if progressPerSegment is 0 (only one mesh)
    let localProgress = 0;
    if (progressPerSegment > 0) {
      // localProgress = (this.overallProgress - (indexA * progressPerSegment)) / progressPerSegment;
      localProgress = scaledProgress - indexA; // Simpler way: fraction part of scaledProgress
    }

    // Handle edge case: progress is exactly 1.0
    if (this.overallProgress >= 1.0) {
      indexA = totalSegments;
      indexB = totalSegments;
      localProgress = 1.0; // Should blend fully to the last mesh
    }

    // Ensure localProgress is clamped (due to potential float inaccuracies)
    localProgress = THREE.MathUtils.clamp(localProgress, 0.0, 1.0);

    const geomA = this.meshSequenceGeometries[indexA];
    const geomB = this.meshSequenceGeometries[indexB];

    if (!geomA || !geomB) {
      console.error('IntersectionService: Invalid geometries found for blending at indices', indexA, indexB);
      return this.meshSequenceGeometries[0]; // Fallback
    }

    // If the two geometries are the same (e.g., at progress 0 or 1), return one directly
    if (indexA === indexB) {
      return geomA;
    }

    // Perform the blending
    return this.blendGeometry(geomA, geomB, localProgress);
  }

  private blendGeometry(from: THREE.BufferGeometry, to: THREE.BufferGeometry, progress: number): THREE.BufferGeometry {
    const blended = new THREE.BufferGeometry();
    const originPositions = from.attributes.position.array;
    const destinationPositions = to.attributes.position.array;
    const blendedPositions = new Float32Array(originPositions.length);

    for (let i = 0; i < originPositions.length; i += 3) {
      const originVert = new THREE.Vector3(originPositions[i], originPositions[i + 1], originPositions[i + 2]);
      const destinationVert = new THREE.Vector3(destinationPositions[i], destinationPositions[i + 1], destinationPositions[i + 2]);
      const blendedVert = new THREE.Vector3().lerpVectors(originVert, destinationVert, progress);

      blendedPositions[i] = blendedVert.x;
      blendedPositions[i + 1] = blendedVert.y;
      blendedPositions[i + 2] = blendedVert.z;
    }

    blended.setAttribute('position', new THREE.BufferAttribute(blendedPositions, 3));

    if (from.attributes.normal) blended.setAttribute('normal', from.attributes.normal.clone());
    if (from.attributes.uv) blended.setAttribute('uv', from.attributes.uv.clone());
    if (from.index) blended.setIndex(from.index.clone());

    return blended;
  }
}
