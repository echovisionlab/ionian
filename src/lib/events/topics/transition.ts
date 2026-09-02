import { TransitionType } from '@/lib/types';

export type TransitionEvents = {
  /** transition started */
  transitionStarted: { type: TransitionType };

  /** transition progressed */
  transitionProgressed: { type: TransitionType; progress: number };

  /** transition finished */
  transitionFinished: { type: TransitionType };

  /** transition cancelled */
  transitionCancelled: { type: TransitionType };
};
