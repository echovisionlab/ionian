import * as THREE from 'three';
import { Vector3Like } from 'three';
import instanceFragmentShader from './shaders/instanceFragmentShader';
import instanceVertexShader from './shaders/instanceVertexShader';

type MaterialUniforms = {
  uTime: { value: number };
  uProgress: { value: number };
  uTexture: { value: THREE.DataTexture | null };
  uVelocity: { value: THREE.DataTexture | null };
  uOriginTexture: { value: THREE.Texture | null };
  uDestinationTexture: { value: THREE.Texture | null };
};

/**
 * InstancedMeshManager is responsible for managing instanced meshes.
 */
export class InstancedMeshManager {
  private size: number;
  private mesh: THREE.InstancedMesh;

  private readonly shaderMaterial: THREE.ShaderMaterial;
  private readonly fallbackGeometry: THREE.BufferGeometry;

  private readonly uniforms: MaterialUniforms;
  private geometries: Map<string, THREE.BufferGeometry>;
  private uvRefsCache: Map<number, THREE.InstancedBufferAttribute>;

  private previousScale: Vector3Like;

  /**
   * Creates a new InstancedMeshManager instance.
   * @param initialSize The initial size of the instanced mesh.
   */
  constructor(initialSize: number) {
    this.size = initialSize;
    this.geometries = new Map();
    this.uvRefsCache = new Map();

    this.previousScale = { x: 1, y: 1, z: 1 };

    this.uniforms = {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uTexture: { value: null },
      uVelocity: { value: null },
      uOriginTexture: { value: null },
      uDestinationTexture: { value: null },
    };

    this.shaderMaterial = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: instanceVertexShader,
      fragmentShader: instanceFragmentShader,
    });

    this.fallbackGeometry = new THREE.BoxGeometry(0.001, 0.001, 0.001);
    this.mesh = this.createInstancedMesh(initialSize, this.fallbackGeometry, this.shaderMaterial);
    this.mesh.material = this.shaderMaterial;
  }

  /**
   * Gets the instanced mesh.
   * @returns The instanced mesh.
   */
  getMesh() {
    return this.mesh;
  }

  /**
   * Updates the instanced mesh.
   * @param elapsedTime The elapsed time.
   */
  update(elapsedTime: number) {
    const material = this.mesh.material;
    if (material instanceof THREE.ShaderMaterial || material instanceof THREE.RawShaderMaterial) {
      material.uniforms.uTime.value = elapsedTime;
    }
  }

  updateTextureInterpolation(textureA: THREE.Texture, textureB: THREE.Texture, progress: number) {
    this.uniforms.uOriginTexture.value = textureA;
    this.uniforms.uDestinationTexture.value = textureB;
    this.uniforms.uProgress.value = progress;
  }

  setGeometrySize(size: THREE.Vector3Like) {
    this.mesh.geometry.scale(1 / this.previousScale.x, 1 / this.previousScale.y, 1 / this.previousScale.z);
    this.mesh.geometry.scale(size.x, size.y, size.z);
    this.previousScale = size;
  }

  /**
   * Use the matcap material for the instanced mesh.
   */
  useMatcapMaterial() {
    this.mesh.material = this.shaderMaterial;
  }

  /**
   * Use the specified geometry for the instanced mesh.
   * @param id The ID of the geometry to use.
   */
  useGeometry(id: string) {
    const geometry = this.geometries.get(id);
    if (geometry) {
      this.mesh.geometry = geometry;
    }
  }

  /**
   * Updates the velocity texture.
   * @param texture The velocity texture to update with.
   */
  updateVelocityTexture(texture: THREE.Texture) {
    this.shaderMaterial.uniforms.uVelocity.value = texture;
  }

  /**
   * Updates the position texture.
   * @param texture The position texture to update with.
   */
  updatePositionTexture(texture: THREE.Texture) {
    this.shaderMaterial.uniforms.uTexture.value = texture;
  }

  /**
   * Resizes or replaces the instanced mesh.
   * @param size The new size of the instanced mesh.
   * @returns An object containing the updated mesh, the previous mesh, and a boolean indicating whether the mesh was updated.
   */
  resize(size: number): { current: THREE.InstancedMesh; previous: THREE.InstancedMesh } {
    if (this.size === size) return { current: this.mesh, previous: this.mesh };

    this.size = size;

    // create new instances since it is greater than the last known value
    const prev = this.mesh;

    this.mesh = this.createInstancedMesh(size, prev.geometry, prev.material);
    this.copyMeshState(prev, this.mesh);
    this.replaceMeshInParent(prev, this.mesh);

    return { current: this.mesh, previous: prev };
  }

  /**
   * Disposes the resources used by the InstancedMeshManager.
   */
  dispose() {
    this.mesh.dispose();

    this.geometries.forEach((geometry) => geometry.dispose());
    this.shaderMaterial.dispose();

    this.uvRefsCache.clear();
    this.geometries.clear();
  }

  /**
   * Registers a geometry.
   * @param id The ID of the geometry to register.
   * @param geometry The geometry to register.
   */
  registerGeometry(id: string, geometry: THREE.BufferGeometry) {
    const previous = this.geometries.get(id);

    if (previous) {
      if (previous === geometry) {
        return;
      }
    }

    // finally, we are attaching uvRefs.
    const uvRefs = this.createUVRefs(this.size);
    geometry.setAttribute('uvRef', uvRefs);

    this.geometries.set(id, geometry);

    if (this.mesh.geometry === previous) {
      this.mesh.geometry = geometry;
    }

    previous?.dispose();
  }

  /**
   * Gets the UV references for the specified size.
   * @param size The size for which to generate UV references.
   * @returns The UV references.
   */
  private createUVRefs(size: number) {
    const cached = this.uvRefsCache.get(size);

    if (cached) {
      return cached;
    }

    const uvRefs = new Float32Array(size * size * 2);

    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const index = i * size + j;
        uvRefs[2 * index] = j / (size - 1);
        uvRefs[2 * index + 1] = i / (size - 1);
      }
    }

    const attr = new THREE.InstancedBufferAttribute(uvRefs, 2);

    this.uvRefsCache.set(size, attr);
    return attr;
  }

  /**
   * Creates a new instanced mesh.
   * @param size The size of the instanced mesh.
   * @param geometry The geometry to use for the instanced mesh.
   * @param material The material to use for the instanced mesh.
   * @returns The created instanced mesh.
   */
  private createInstancedMesh(size: number, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]) {
    geometry = geometry || this.fallbackGeometry;
    geometry.setAttribute('uvRef', this.createUVRefs(size));
    const count = size * size;
    return new THREE.InstancedMesh(geometry, material, count);
  }

  private copyMeshState(source: THREE.InstancedMesh, target: THREE.InstancedMesh) {
    target.name = source.name;
    target.up.copy(source.up);
    target.position.copy(source.position);
    target.quaternion.copy(source.quaternion);
    target.scale.copy(source.scale);
    target.matrix.copy(source.matrix);
    target.matrixWorld.copy(source.matrixWorld);
    target.matrixAutoUpdate = source.matrixAutoUpdate;
    target.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
    target.matrixWorldNeedsUpdate = source.matrixWorldNeedsUpdate;
    target.layers.mask = source.layers.mask;
    target.visible = source.visible;
    target.castShadow = source.castShadow;
    target.receiveShadow = source.receiveShadow;
    target.frustumCulled = source.frustumCulled;
    target.renderOrder = source.renderOrder;
    target.animations = source.animations;
    target.userData = source.userData;
    target.customDepthMaterial = source.customDepthMaterial;
    target.customDistanceMaterial = source.customDistanceMaterial;
    target.onBeforeRender = source.onBeforeRender;
    target.onAfterRender = source.onAfterRender;
  }

  private replaceMeshInParent(previous: THREE.InstancedMesh, current: THREE.InstancedMesh) {
    const parent = previous.parent;
    if (!parent) return;

    const previousIndex = parent.children.indexOf(previous);
    parent.add(current);
    parent.remove(previous);

    const currentIndex = parent.children.indexOf(current);
    if (previousIndex < 0 || currentIndex < 0 || previousIndex === currentIndex) return;

    parent.children.splice(currentIndex, 1);
    parent.children.splice(Math.min(previousIndex, parent.children.length), 0, current);
  }
}
