import { DefaultEventEmitter } from '@/lib/events';
import { ServiceState } from '@/lib/types';
import * as THREE from 'three';
import { PositionAtlasEntry, SimulationRenderer } from './simulationRenderer';

export class SimulationRendererService {
  private state!: ServiceState;
  private textureSize: number;
  private overallProgress: number;
  private velocityTractionForce: number;
  private positionalTractionForce: number;

  private simulationRenderer;
  private webGLRenderer;
  private eventEmitter;

  private currentAtlasEntry: PositionAtlasEntry | null = null;

  private lastKnownVelocityDataTexture: THREE.Texture;
  private lastKnownPositionDataTexture: THREE.Texture;

  constructor(eventEmitter: DefaultEventEmitter, size: number, webGLRenderer: THREE.WebGLRenderer) {
    this.eventEmitter = eventEmitter;
    this.webGLRenderer = webGLRenderer;
    this.textureSize = size;
    this.overallProgress = 0;
    this.velocityTractionForce = 0.1;
    this.positionalTractionForce = 0.1;

    this.updateServiceState('initializing');

    this.simulationRenderer = new SimulationRenderer(this.textureSize, this.webGLRenderer);
    this.lastKnownVelocityDataTexture = this.simulationRenderer.getVelocityTexture();
    this.lastKnownPositionDataTexture = this.simulationRenderer.getPositionTexture();

    this.updateServiceState('ready');
  }

  /**
   * Sets the position data texture atlas for the simulation.
   * @param entry An object containing the atlas texture and related parameters.
   */
  setPositionAtlas(entry: PositionAtlasEntry) {
    // Validate texture size consistency if needed (atlas width vs textureSize * numMeshes)
    const expectedWidth = entry.singleTextureSize * entry.numMeshes;
    if (entry.dataTexture.image.width !== expectedWidth) {
      this.eventEmitter.emit('invalidRequest', { message: `Atlas texture width mismatch.` });
      return;
    }
    this.currentAtlasEntry = entry; // Store the current atlas info
    this.simulationRenderer.setPositionAtlas(entry);
  }

  /**
   * Sets the overall progress for the mesh sequence transition.
   * @param progress The progress value (0.0 to 1.0).
   */
  setOverallProgress(progress: number) {
    this.overallProgress = progress; // Store progress
    this.simulationRenderer.setOverallProgress(this.overallProgress);
  }

  setTextureSize(size: number) {
    this.updateServiceState('initializing');
    this.simulationRenderer.dispose();
    this.textureSize = size;
    this.simulationRenderer = new SimulationRenderer(size, this.webGLRenderer);
    this.updateServiceState('ready');
  }

  setVelocityTractionForce(force: number) {
    this.velocityTractionForce = force;
    this.simulationRenderer.setVelocityTractionForce(this.velocityTractionForce);
  }

  setPositionalTractionForce(force: number) {
    this.positionalTractionForce = force;
    this.simulationRenderer.setPositionalTractionForce(this.positionalTractionForce);
  }

  compute(elapsedTime: number) {
    if (this.state !== 'ready') return; // Don't compute if not ready
    this.simulationRenderer.compute(elapsedTime);
    // Update last known textures after computation
    this.lastKnownVelocityDataTexture = this.simulationRenderer.getVelocityTexture();
    this.lastKnownPositionDataTexture = this.simulationRenderer.getPositionTexture();
  }

  getVelocityTexture(): THREE.Texture {
    // Return the latest texture obtained during compute()
    return this.lastKnownVelocityDataTexture;
  }

  getPositionTexture(): THREE.Texture {
    // Return the latest texture obtained during compute()
    return this.lastKnownPositionDataTexture;
  }

  dispose() {
    this.updateServiceState('disposed');
    this.simulationRenderer.dispose();
    // Dispose last known textures only if they are managed solely here (unlikely)
    // this.lastKnownVelocityDataTexture.dispose();
    // this.lastKnownPositionDataTexture.dispose();
    this.currentAtlasEntry = null; // Clear reference
  }

  private updateServiceState(serviceState: ServiceState) {
    this.state = serviceState;
    this.eventEmitter.emit('serviceStateUpdated', { type: 'simulation', state: serviceState });
  }

  setInteractionPosition(position: THREE.Vector4Like) {
    // Pass through to the renderer
    this.simulationRenderer.setInteractionPosition(position);
  }

  setMaxRepelDistance(distance: number) {
    // Pass through to the renderer
    this.simulationRenderer.setMaxRepelDistance(distance);
  }
}
