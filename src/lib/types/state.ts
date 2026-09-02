import * as THREE from 'three';
import { TextureSequence } from './index';

/**
 * Represents the current state of the system.
 */
export interface EngineState {
  pointerPosition: THREE.Vector2Like;
  textureSize: number;

  meshSequence: string[];
  overallProgress: number;

  velocityTractionForce: number;
  positionalTractionForce: number;
  maxRepelDistance: number;

  textureSequence: TextureSequence;

  instanceGeometryScale: THREE.Vector3Like;
  useIntersect: boolean;
}
