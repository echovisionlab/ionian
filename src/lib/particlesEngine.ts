import { linear } from '@/lib/easing';
import { DefaultEventEmitter } from '@/lib/events/defaultEventEmitter';
import { AssetService, LoadMeshOptions } from '@/lib/services/assets/assetService';
import { DataTextureService } from '@/lib/services/dataTexture/dataTextureService';
import { InstancedMeshManager } from '@/lib/services/instancedmesh/instancedMeshManager';
import { IntersectionService } from '@/lib/services/intersection/intersectionService';
import { SimulationRendererService } from '@/lib/services/simulation/simulationRendererService';
import { TransitionService } from '@/lib/services/transition/transitionService';
import { resolveSequenceInterpolation } from '@/lib/textureSequence';
import { EasingFunction, ServiceState, ServiceType, TextureSequence, TextureSequenceItem, TransitionDetail, TransitionOptions } from '@/lib/types';
import { EngineState } from '@/lib/types/state';
import { clamp } from '@/lib/utils';
import * as THREE from 'three';

/**
 * Parameters for creating a ParticlesEngine instance.
 */
export type ParticlesEngineParameters = {
  textureSize: number;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera?: THREE.Camera;
  useIntersection?: boolean;
  dracoDecoderPath?: string | null;
};

type ServiceStates = Record<ServiceType, ServiceState>;

/**
 * The main class for the particle engine.
 */
export class ParticlesEngine {
  private simulationRendererService: SimulationRendererService;
  private renderer: THREE.WebGLRenderer;

  private scene: THREE.Scene;
  private serviceStates: ServiceStates;

  // assets
  private assetService: AssetService;
  private dataTextureManager: DataTextureService;
  private instancedMeshManager: InstancedMeshManager;

  private transitionService: TransitionService;
  private engineState: EngineState;

  private intersectionService: IntersectionService;

  private meshSequenceAtlasTexture: THREE.DataTexture | null = null;
  private lastRenderElapsedTimeSeconds: number | null = null;

  public eventEmitter: DefaultEventEmitter;

  /**
   * Creates a new ParticlesEngine instance.
   * @param params The parameters for creating the instance.
   */
  constructor(params: ParticlesEngineParameters) {
    const { scene, renderer, camera, textureSize, useIntersection = true } = params;

    this.eventEmitter = new DefaultEventEmitter();
    this.serviceStates = this.getInitialServiceStates();
    this.eventEmitter.on('serviceStateUpdated', this.handleServiceStateUpdated.bind(this));

    this.scene = scene;
    this.renderer = renderer;
    this.engineState = this.initialEngineState(params);

    this.assetService = new AssetService(this.eventEmitter, { dracoDecoderPath: params.dracoDecoderPath });
    this.transitionService = new TransitionService(this.eventEmitter);
    this.dataTextureManager = new DataTextureService(this.eventEmitter, textureSize);
    this.simulationRendererService = new SimulationRendererService(this.eventEmitter, textureSize, this.renderer);
    this.instancedMeshManager = new InstancedMeshManager(textureSize);
    this.scene.add(this.instancedMeshManager.getMesh());

    this.intersectionService = new IntersectionService(this.eventEmitter, camera);
    if (!useIntersection) this.intersectionService.setActive(false);
    this.setOverallProgress(0, false);

    this.eventEmitter.on('interactionPositionUpdated', this.handleInteractionPositionUpdated.bind(this));
  }

  /**
   * Renders the scene.
   * @param elapsedTime The elapsed time since the last frame.
   */

  render(elapsedTimeMs: number) {
    const elapsedTimeSeconds = elapsedTimeMs / 1000.0;
    const deltaTimeSeconds = this.lastRenderElapsedTimeSeconds === null ? 0 : Math.max(0, elapsedTimeSeconds - this.lastRenderElapsedTimeSeconds);
    this.lastRenderElapsedTimeSeconds = elapsedTimeSeconds;
    this.renderFrame(deltaTimeSeconds, elapsedTimeSeconds);
  }

  renderFrame(deltaTimeSeconds: number, elapsedTimeSeconds: number) {
    this.transitionService.compute(elapsedTimeSeconds);
    this.intersectionService.calculate(this.instancedMeshManager.getMesh());
    this.simulationRendererService.compute(deltaTimeSeconds);
    this.instancedMeshManager.update(elapsedTimeSeconds);
    this.instancedMeshManager.updateVelocityTexture(this.simulationRendererService.getVelocityTexture());
    this.instancedMeshManager.updatePositionTexture(this.simulationRendererService.getPositionTexture());
  }

  setTextureSequence(sequence: TextureSequence) {
    this.engineState.textureSequence = sequence;
    this.eventEmitter.emit('textureSequenceUpdated', { sequence });
    this.setOverallProgress(0, false);
  }

  async setTextureSize(size: number) {
    if (this.engineState.textureSize === size) {
      return;
    }

    const meshSequence = [...this.engineState.meshSequence];
    const overallProgress = this.engineState.overallProgress;

    this.engineState.textureSize = size;

    this.dataTextureManager.setTextureSize(size);
    this.simulationRendererService.setTextureSize(size);
    const { current, previous } = this.instancedMeshManager.resize(size);
    if (current !== previous) {
      previous.dispose();
      if (!current.parent) {
        this.scene.add(current);
      }
    }

    if (meshSequence.length > 0) {
      await this.setMeshSequence(meshSequence);
    }

    this.simulationRendererService.setVelocityTractionForce(this.engineState.velocityTractionForce);
    this.simulationRendererService.setPositionalTractionForce(this.engineState.positionalTractionForce);
    this.simulationRendererService.setMaxRepelDistance(this.engineState.maxRepelDistance);
    this.instancedMeshManager.setGeometrySize(this.engineState.instanceGeometryScale);
    this.setOverallProgress(overallProgress, false);
  }

  registerMesh(id: string, mesh: THREE.Mesh) {
    this.assetService.register(id, mesh);
  }

  registerMatcap(id: string, matcap: THREE.Texture) {
    this.assetService.register(id, matcap);
  }

  async fetchAndRegisterMesh(id: string, url: string, options?: LoadMeshOptions) {
    return await this.assetService.loadMeshAsync(id, url, options);
  }

  async fetchAndRegisterMatcap(id: string, url: string) {
    return await this.assetService.loadTextureAsync(id, url);
  }

  useIntersect(use: boolean) {
    this.intersectionService.setActive(use);
    this.engineState.useIntersect = use;

    // When disabling, ensure the simulation also gets zero interaction
    if (!use) {
      this.engineState.pointerPosition = { x: -99999999, y: -99999999 }; // Keep this for internal state if needed
      // Explicitly send zero interaction to simulation
      this.simulationRendererService.setInteractionPosition({ x: 0, y: 0, z: 0, w: 0 });
    }
  }

  setPointerPosition(position: THREE.Vector2Like) {
    if (!this.engineState.useIntersect) return;
    this.engineState.pointerPosition = position;
    this.intersectionService.setPointerPosition(position);
  }

  setGeometrySize(geometrySize: THREE.Vector3Like) {
    this.engineState.instanceGeometryScale = geometrySize;
    this.instancedMeshManager.setGeometrySize(geometrySize);
  }

  setVelocityTractionForce(force: number) {
    this.engineState.velocityTractionForce = force;
    this.simulationRendererService.setVelocityTractionForce(force);
  }

  setPositionalTractionForce(force: number) {
    this.engineState.positionalTractionForce = force;
    this.simulationRendererService.setPositionalTractionForce(force);
  }

  setMaxRepelDistance(distance: number) {
    this.engineState.maxRepelDistance = distance;
    this.simulationRendererService.setMaxRepelDistance(distance);
  }

  /**
   * Sets the sequence of meshes for particle transitions.
   * This will generate a texture atlas containing position data for all meshes.
   * @param meshIDs An array of registered mesh IDs in the desired sequence order.
   */
  async setMeshSequence(meshIDs: string[]) {
    if (!meshIDs || meshIDs.length < 1) {
      this.eventEmitter.emit('invalidRequest', { message: 'Mesh sequence must contain at least one mesh ID.' });
      this.engineState.meshSequence = []; // Clear sequence state
      this.intersectionService.setMeshSequence([]); // Clear intersection sequence
      return;
    }
    this.engineState.meshSequence = meshIDs;
    this.engineState.overallProgress = 0; // Reset progress when sequence changes

    // Get valid mesh objects
    const meshes = meshIDs.map((id) => this.assetService.getMesh(id)).filter((mesh) => mesh !== null) as THREE.Mesh[];

    // Handle missing meshes
    if (meshes.length !== meshIDs.length) {
      const missing = meshIDs.filter((id) => !this.assetService.getMesh(id));
      console.warn(`Could not find meshes for IDs: ${missing.join(', ')}. Proceeding with ${meshes.length} found meshes.`);
      this.eventEmitter.emit('invalidRequest', { message: `Could not find meshes for IDs: ${missing.join(', ')}` });
      if (meshes.length < 1) {
        this.engineState.meshSequence = []; // Clear sequence state if none found
        this.intersectionService.setMeshSequence([]);
        return; // Stop if no valid meshes
      }
      // Update sequence state to only include valid meshes found
      this.engineState.meshSequence = meshes.map((m) => m.name);
    }

    try {
      // Generate the atlas texture
      this.meshSequenceAtlasTexture = await this.dataTextureManager.createSequenceDataTextureAtlas(meshes, this.engineState.textureSize);

      // Update the simulation renderer
      this.simulationRendererService.setPositionAtlas({
        dataTexture: this.meshSequenceAtlasTexture,
        textureSize: this.engineState.textureSize, // Pass the size of the *output* GPGPU texture
        numMeshes: this.engineState.meshSequence.length, // Use the potentially updated count
        singleTextureSize: this.engineState.textureSize, // Size of one mesh's data within atlas
      });
      // Set initial progress in simulation (should be 0 after sequence change)
      this.simulationRendererService.setOverallProgress(this.engineState.overallProgress);

      // Update IntersectionService with the valid meshes
      this.intersectionService.setMeshSequence(meshes);
      this.intersectionService.setOverallProgress(this.engineState.overallProgress);

      this.setOverallProgress(0, false);
    } catch (error) {
      console.error('Failed during mesh sequence setup:', error);
      this.meshSequenceAtlasTexture = null;
      // Consider resetting related states or services
    }
  }

  /**
   * Sets the overall progress through the mesh sequence.
   * @param progress A value between 0.0 (first mesh) and 1.0 (last mesh).
   * @param override If true, cancels any ongoing mesh sequence transition before setting the value. Defaults to true.
   */
  setOverallProgress(progress: number, override: boolean = true) {
    if (override) {
      this.eventEmitter.emit('transitionCancelled', { type: 'mesh-sequence' });
    }

    const clampedProgress = clamp(progress, 0.0, 1.0);
    this.engineState.overallProgress = clampedProgress;
    this.simulationRendererService.setOverallProgress(clampedProgress);
    this.intersectionService.setOverallProgress(clampedProgress);
    const { textureA, textureB, localProgress } = this.calculateTextureInterpolation(clampedProgress);
    this.instancedMeshManager.updateTextureInterpolation(textureA, textureB, localProgress);
  }

  /**
   * Schedules a smooth transition for the overall mesh sequence progress.
   * @param targetProgress The final progress value (0.0 to 1.0) to transition to.
   * @param duration Duration of the transition in milliseconds.
   * @param easing Easing function to use.
   * @param options Transition options (onBegin, onProgress, onFinished, onCancelled).
   * @param override If true, cancels any ongoing mesh sequence transitions.
   */
  scheduleMeshSequenceTransition(
    targetProgress: number,
    duration: number = 1000,
    easing: EasingFunction = linear,
    options: TransitionOptions = {},
    override: boolean = true, // Default to override for simplicity
  ) {
    if (override) this.eventEmitter.emit('transitionCancelled', { type: 'mesh-sequence' });
    const startProgress = this.engineState.overallProgress;
    const progressDiff = targetProgress - startProgress;
    const handleProgressUpdate = (transitionProgress: number) => {
      const currentOverallProgress = startProgress + progressDiff * transitionProgress;
      // Call setOverallProgress with override=false as this is part of a transition
      this.setOverallProgress(currentOverallProgress, false);
      options.onTransitionProgress?.(currentOverallProgress);
    };
    const transitionDetail: TransitionDetail = { duration, easing };
    const transitionOptions: TransitionOptions = {
      ...options,
      onTransitionProgress: handleProgressUpdate,
      onTransitionBegin: options.onTransitionBegin,
      onTransitionFinished: () => {
        // Ensure final value is set precisely, again with override=false
        this.setOverallProgress(targetProgress, false);
        options.onTransitionFinished?.();
      },
      onTransitionCancelled: options.onTransitionCancelled,
    };
    this.transitionService.enqueue('mesh-sequence', transitionDetail, transitionOptions);
  }

  handleServiceStateUpdated({ type, state }: { type: ServiceType; state: ServiceState }) {
    this.serviceStates[type] = state;
  }

  getObject(): THREE.Mesh {
    return this.instancedMeshManager.getMesh();
  }

  getMeshIDs() {
    return this.assetService.getMeshIDs();
  }

  getMatcapIDs() {
    return this.assetService.getTextureIDs();
  }

  getMeshes() {
    return this.assetService.getMeshes();
  }

  getTextures() {
    return this.assetService.getTextures();
  }

  public getTextureSize(): number {
    return this.engineState.textureSize;
  }

  public getUseIntersect(): boolean {
    return this.engineState.useIntersect;
  }

  public getEngineStateSnapshot(): Readonly<EngineState> {
    return { ...this.engineState }; // Return a copy or make EngineState properties readonly
  }

  /**
   * Disposes the resources used by the engine.
   */
  dispose() {
    // Check if scene exists before removing
    if (this.scene && this.instancedMeshManager) {
      this.scene.remove(this.instancedMeshManager.getMesh());
    }
    // Dispose services safely
    this.simulationRendererService?.dispose();
    this.instancedMeshManager?.dispose();
    this.intersectionService?.dispose();
    this.assetService?.dispose();
    this.dataTextureManager?.dispose();
    this.eventEmitter?.dispose(); // Dispose event emitter too
  }

  private initialEngineState(params: ParticlesEngineParameters): EngineState {
    return {
      textureSize: params.textureSize,
      meshSequence: [],
      overallProgress: 0,
      textureSequence: [],
      velocityTractionForce: 0.1,
      positionalTractionForce: 0.1,
      maxRepelDistance: 0.3,
      pointerPosition: { x: 0, y: 0 },
      instanceGeometryScale: { x: 1, y: 1, z: 1 },
      useIntersect: params.useIntersection ?? true,
    };
  }

  private getInitialServiceStates(): ServiceStates {
    return {
      'data-texture': 'created',
      'instanced-mesh': 'created',
      matcap: 'created',
      simulation: 'created',
      asset: 'created',
    };
  }

  private handleInteractionPositionUpdated({ position }: { position: THREE.Vector4Like }) {
    this.simulationRendererService.setInteractionPosition(position);
  }

  private calculateTextureInterpolation(progress: number): {
    textureA: THREE.Texture;
    textureB: THREE.Texture;
    localProgress: number;
  } {
    const sequence = this.engineState.textureSequence;
    const numItems = sequence.length;

    if (numItems === 0) {
      const defaultTex = this.assetService.getFallbackTexture();
      return { textureA: defaultTex, textureB: defaultTex, localProgress: 0 };
    }
    if (numItems === 1) {
      const tex = this.getTextureForSequenceItem(sequence[0]);
      return { textureA: tex, textureB: tex, localProgress: 0 };
    }

    const { indexA, indexB, localProgress } = resolveSequenceInterpolation(progress, numItems);

    const itemA = sequence[indexA];
    const itemB = sequence[indexB];

    const textureA = this.getTextureForSequenceItem(itemA);
    const textureB = this.getTextureForSequenceItem(itemB);

    return { textureA, textureB, localProgress: localProgress };
  }

  private getTextureForSequenceItem(item: TextureSequenceItem): THREE.Texture {
    if (item.type === 'matcap') {
      return this.assetService.getMatcapTexture(item.id);
    } else {
      return this.assetService.getSolidColorTexture(item.value);
    }
  }
}
