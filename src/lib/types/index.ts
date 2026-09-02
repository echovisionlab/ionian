import * as THREE from 'three';

/**
 * Represents the data of a mesh, including its position, normal, and scale.
 */
export type MeshData = {
  position: ArrayLike<number>;
  normal?: ArrayLike<number>;
  scale: { x: number; y: number; z: number };
};

/**
 * Represents an easing function.
 */
export interface EasingFunction {
  (n: number): number;
}

export type ServiceType = 'data-texture' | 'matcap' | 'instanced-mesh' | 'simulation' | 'asset';
export type ServiceState = 'created' | 'initializing' | 'ready' | 'disposed' | 'error' | 'loading';
export type TransitionType = 'data-texture' | 'texture' | 'mesh-sequence';

export interface TransitionDetail {
  duration: number;
  easing: EasingFunction;
}

export type TransitionCallback = (progress: number) => void;
export type Callback = () => void;
export type TransitionOptions = {
  onTransitionBegin?: Callback;
  onTransitionProgress?: TransitionCallback;
  onTransitionFinished?: Callback;
  onTransitionCancelled?: Callback;
};

export type TextureSequenceItem = { type: 'matcap'; id: string } | { type: 'color'; value: THREE.ColorRepresentation }; // THREE.ColorRepresentation 사용

export type TextureSequence = TextureSequenceItem[];
