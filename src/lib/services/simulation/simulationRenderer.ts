// --- START OF FILE simulationRenderer.ts ---

import { clamp, createBlankDataTexture, createSpherePoints } from '@/lib/utils';
import * as THREE from 'three';
import { GPUComputationRenderer, Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
// import mixShader from './shaders/simulationMixShader'; // Assuming unused
import positionShader from './shaders/simulationPositionShader';
import velocityShader from './shaders/simulationVelocityShader';

export type PositionAtlasEntry = {
  dataTexture: THREE.DataTexture;
  numMeshes: number;
  singleTextureSize: number;
  textureSize: number; // Size of the GPGPU output texture
};

/**
 * SimulationRenderer is responsible for running the particle simulation using the GPU.
 */
export class SimulationRenderer {
  gpuComputationRenderer: GPUComputationRenderer;
  webGLRenderer: THREE.WebGLRenderer;

  // GPGPU Variables
  private readonly velocityVar: Variable;
  private readonly positionVar: Variable;

  // Input Data Textures (References)
  private readonly initialPositionDataTexture: THREE.DataTexture; // Used only for first init
  private readonly initialVelocityDataTexture: THREE.DataTexture; // Blank texture for init
  private positionAtlasTexture: THREE.Texture | null = null; // Holds the current mesh sequence atlas

  // Uniforms
  readonly interactionPosition: THREE.Vector4;

  // Cache last known output textures
  private lastKnownPositionDataTexture: THREE.Texture;
  private lastKnownVelocityDataTexture: THREE.Texture;

  /**
   * Creates a new SimulationRenderer instance.
   * @param size The size of the simulation textures (width/height).
   * @param webGLRenderer The WebGL renderer.
   * @param initialPosition The initial position data texture (optional, defaults to sphere).
   */
  constructor(size: number, webGLRenderer: THREE.WebGLRenderer, initialPosition?: THREE.DataTexture) {
    this.webGLRenderer = webGLRenderer;
    this.gpuComputationRenderer = new GPUComputationRenderer(size, size, this.webGLRenderer);

    // Set data type (important for precision)
    if (!webGLRenderer.capabilities.isWebGL2 && webGLRenderer.extensions.get('OES_texture_float')) {
      this.gpuComputationRenderer.setDataType(THREE.FloatType);
    } else if (!webGLRenderer.capabilities.isWebGL2) {
      this.gpuComputationRenderer.setDataType(THREE.HalfFloatType); // Fallback for WebGL1 without float support
    }

    // Create initial data textures that will be passed to GPGPU variables
    this.initialPositionDataTexture = initialPosition ?? createSpherePoints(size);
    this.initialVelocityDataTexture = createBlankDataTexture(size);
    this.interactionPosition = new THREE.Vector4(0, 0, 0, 0);

    // Initialize GPGPU variables with the initial data textures
    this.velocityVar = this.gpuComputationRenderer.addVariable('uCurrentVelocity', velocityShader, this.initialVelocityDataTexture);
    this.positionVar = this.gpuComputationRenderer.addVariable('uCurrentPosition', positionShader, this.initialPositionDataTexture);

    // --- Configure Uniforms ---
    // Velocity Shader Uniforms
    this.velocityVar.material.uniforms.uTime = { value: 0 };
    this.velocityVar.material.uniforms.uInteractionPosition = { value: this.interactionPosition };
    this.velocityVar.material.uniforms.uCurrentPosition = { value: null }; // Dependency
    this.velocityVar.material.uniforms.uTractionForce = { value: 0.1 };
    this.velocityVar.material.uniforms.uMaxRepelDistance = { value: 0.3 };
    this.velocityVar.material.uniforms.uPositionAtlas = { value: null }; // Will be set by setPositionAtlas or initially below
    this.velocityVar.material.uniforms.uOverallProgress = { value: 0.0 };
    this.velocityVar.material.uniforms.uNumMeshes = { value: 1 }; // Start with 1 (for initial texture)
    this.velocityVar.material.uniforms.uSingleTextureSize = { value: size }; // Current GPGPU size

    // Position Shader Uniforms
    this.positionVar.material.uniforms.uTime = { value: 0 };
    this.positionVar.material.uniforms.uTractionForce = { value: 0.1 };
    this.positionVar.material.uniforms.uInteractionPosition = { value: this.interactionPosition };
    this.positionVar.material.uniforms.uCurrentPosition = { value: null }; // Dependency
    this.positionVar.material.uniforms.uCurrentVelocity = { value: null }; // Dependency
    this.positionVar.material.uniforms.uPositionAtlas = { value: null }; // Will be set by setPositionAtlas or initially below
    this.positionVar.material.uniforms.uOverallProgress = { value: 0.0 };
    this.positionVar.material.uniforms.uNumMeshes = { value: 1 }; // Start with 1
    this.positionVar.material.uniforms.uSingleTextureSize = { value: size }; // Current GPGPU size

    // --- Set Dependencies ---
    this.gpuComputationRenderer.setVariableDependencies(this.positionVar, [this.positionVar, this.velocityVar]);
    this.gpuComputationRenderer.setVariableDependencies(this.velocityVar, [this.velocityVar, this.positionVar]);

    // --- Initialize GPGPU ---
    const initError = this.gpuComputationRenderer.init();
    if (initError !== null) {
      throw new Error('Failed to initialize SimulationRenderer: ' + initError);
    }

    // Use the initial texture as the 'atlas' before the real one is set
    this.positionVar.material.uniforms.uPositionAtlas.value = this.initialPositionDataTexture;
    // Ensure numMeshes and size reflect this initial single texture state
    this.positionVar.material.uniforms.uNumMeshes.value = 1;
    this.velocityVar.material.uniforms.uNumMeshes.value = 1;
    this.positionVar.material.uniforms.uSingleTextureSize.value = size;
    this.velocityVar.material.uniforms.uSingleTextureSize.value = size;
    // Set initial texture dependencies correctly
    this.positionVar.material.uniforms.uCurrentVelocity.value = this.gpuComputationRenderer.getCurrentRenderTarget(this.velocityVar).texture;
    this.velocityVar.material.uniforms.uCurrentPosition.value = this.gpuComputationRenderer.getCurrentRenderTarget(this.positionVar).texture;

    // Cache the initial output textures
    this.lastKnownVelocityDataTexture = this.gpuComputationRenderer.getCurrentRenderTarget(this.velocityVar).texture;
    this.lastKnownPositionDataTexture = this.gpuComputationRenderer.getCurrentRenderTarget(this.positionVar).texture;
  }

  /**
   * Sets the mesh sequence position atlas texture and related uniforms.
   * @param entry Information about the atlas texture.
   */
  setPositionAtlas(entry: PositionAtlasEntry) {
    // Validate texture dimensions (optional but good practice)
    const expectedAtlasWidth = entry.singleTextureSize * entry.numMeshes;
    if (entry.dataTexture.image.width !== expectedAtlasWidth || entry.dataTexture.image.height !== entry.singleTextureSize) {
      console.error(
        `SimulationRenderer: Atlas texture dimension mismatch! Expected ${expectedAtlasWidth}x${entry.singleTextureSize}, Got ${entry.dataTexture.image.width}x${entry.dataTexture.image.height}`,
      );
    }

    this.positionAtlasTexture = entry.dataTexture;
    const numMeshes = entry.numMeshes > 0 ? entry.numMeshes : 1; // Avoid 0

    // Update uniforms that depend on the atlas
    this.positionVar.material.uniforms.uPositionAtlas.value = this.positionAtlasTexture;
    this.positionVar.material.uniforms.uNumMeshes.value = numMeshes;
    this.positionVar.material.uniforms.uSingleTextureSize.value = entry.singleTextureSize; // The size of one mesh's data within the atlas

    this.velocityVar.material.uniforms.uPositionAtlas.value = this.positionAtlasTexture;
    this.velocityVar.material.uniforms.uNumMeshes.value = numMeshes;
    this.velocityVar.material.uniforms.uSingleTextureSize.value = entry.singleTextureSize;

    // IMPORTANT: Ensure texture dependencies are updated.
    // The GPGPU library handles the ping-pong swap. We just need to tell
    // the shader which texture (the *output* of the other variable from the *last* frame)
    // to read from *this* frame.
    this.positionVar.material.uniforms.uCurrentVelocity.value = this.gpuComputationRenderer.getCurrentRenderTarget(this.velocityVar).texture;
    this.velocityVar.material.uniforms.uCurrentPosition.value = this.gpuComputationRenderer.getCurrentRenderTarget(this.positionVar).texture;
    // Note: We don't reset progress here; that's handled by setOverallProgress.
  }

  /**
   * Sets the overall progress for blending between meshes in the atlas.
   * @param progress Value between 0.0 and 1.0.
   */
  setOverallProgress(progress: number) {
    const clampedProgress = clamp(progress, 0.0, 1.0);
    // Update progress in both shaders
    this.positionVar.material.uniforms.uOverallProgress.value = clampedProgress;
    this.velocityVar.material.uniforms.uOverallProgress.value = clampedProgress;
  }

  setMaxRepelDistance(distance: number) {
    this.velocityVar.material.uniforms.uMaxRepelDistance.value = distance;
  }

  setVelocityTractionForce(force: number) {
    this.velocityVar.material.uniforms.uTractionForce.value = force;
  }

  setPositionalTractionForce(force: number) {
    this.positionVar.material.uniforms.uTractionForce.value = force;
  }

  setInteractionPosition(position: THREE.Vector4Like) {
    this.interactionPosition.copy(position);
    // The uniform 'uInteractionPosition' directly references this object,
    // so changes are automatically picked up by the shader.
  }

  /**
   * Disposes the resources used by the simulation renderer.
   */
  dispose() {
    // Dispose GPGPU resources FIRST
    this.gpuComputationRenderer.dispose(); // Should dispose variables, materials, programs, render targets

    // Dispose textures we created or hold references to
    this.initialPositionDataTexture?.dispose();
    this.initialVelocityDataTexture?.dispose();
    // Dispose the atlas texture if it exists and is managed here
    // If the atlas is managed externally (e.g., DataTextureService), it shouldn't be disposed here.
    // Assuming DataTextureService manages its lifecycle.
    // this.positionAtlasTexture?.dispose(); -> Let DataTextureService handle this.
    this.positionAtlasTexture = null;
  }

  /**
   * Computes the next step of the simulation.
   * @param deltaTime The time elapsed since the last frame, in seconds.
   */
  compute(deltaTime: number) {
    // Update time uniforms if they are used for time-dependent effects (like lifespan)
    this.velocityVar.material.uniforms.uTime.value += deltaTime; // Accumulate time
    this.positionVar.material.uniforms.uTime.value += deltaTime; // Accumulate time

    // Update texture uniforms (dependencies) for the *next* computation step.
    // This ensures the shaders read the output from the previous step.
    this.positionVar.material.uniforms.uCurrentVelocity.value = this.gpuComputationRenderer.getCurrentRenderTarget(this.velocityVar).texture;
    this.velocityVar.material.uniforms.uCurrentPosition.value = this.gpuComputationRenderer.getCurrentRenderTarget(this.positionVar).texture;

    // Run the GPGPU computation
    this.gpuComputationRenderer.compute();

    // Update the references to the *latest* output textures *after* computation
    this.lastKnownVelocityDataTexture = this.gpuComputationRenderer.getCurrentRenderTarget(this.velocityVar).texture;
    this.lastKnownPositionDataTexture = this.gpuComputationRenderer.getCurrentRenderTarget(this.positionVar).texture;
  }

  /** Gets the current velocity texture (output from the last compute step). */
  getVelocityTexture(): THREE.Texture {
    return this.lastKnownVelocityDataTexture;
  }

  /** Gets the current position texture (output from the last compute step). */
  getPositionTexture(): THREE.Texture {
    return this.lastKnownPositionDataTexture;
  }
}

// --- END OF FILE simulationRenderer.ts ---
