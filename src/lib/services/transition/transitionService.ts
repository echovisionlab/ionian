import { DefaultEventEmitter } from '@/lib/events';
import { TransitionDetail, TransitionOptions, TransitionType } from '@/lib/types';
import { clamp } from '@/lib/utils';

type TransitionQueueItem = { cancelled: boolean; startTime?: number } & TransitionDetail & TransitionOptions;
type OngoingTransition = { startTime: number } & TransitionQueueItem;

export class TransitionService {
  private readonly eventEmitter;
  private readonly transitions: Map<TransitionType, Array<TransitionQueueItem>> = new Map();
  private readonly ongoingTransitions: Map<TransitionType, OngoingTransition> = new Map();

  constructor(eventEmitter: DefaultEventEmitter) {
    this.eventEmitter = eventEmitter;
    this.eventEmitter.on('transitionCancelled', this.handleTransitionCancelledEvent.bind(this));
  }

  /**
   * Enqueues a transition.
   * @param type - The type of transition.
   * @param transition - The transition details.
   * @param options - Optional transition options.
   */
  enqueue<T extends TransitionType>(type: T, transition: TransitionDetail, options: TransitionOptions = {}) {
    const transitionQueueItem: TransitionQueueItem = {
      ...transition,
      ...options,
      cancelled: false,
      duration: transition.duration * 0.001, // convert to seconds
    };
    this.getQueue(type).push(transitionQueueItem);
  }

  compute(elapsedTime: number) {
    this.transitions.forEach((queue, type) => {
      if (queue.length && !this.ongoingTransitions.has(type)) {
        const transition = queue.shift();
        if (transition) {
          this.ongoingTransitions.set(type, { ...transition, startTime: elapsedTime });
          transition.onTransitionBegin?.();
        }
      }
    });

    this.ongoingTransitions.forEach((transition, type) => {
      if (transition.cancelled) {
        transition.onTransitionCancelled?.();
        this.ongoingTransitions.delete(type);
        return;
      }

      const { startTime, duration, easing } = transition;

      const timeDistance = elapsedTime - startTime;
      const progress = clamp(easing(Math.min(1.0, timeDistance / duration)), 0.0, 1.0);

      this.emitTransitionProgress(type, progress);
      transition.onTransitionProgress?.(progress);

      if (progress >= 1) {
        this.emitTransitionFinished(type);
        transition.onTransitionFinished?.();
        this.ongoingTransitions.delete(type);
      }
    });
  }

  private getQueue(type: TransitionType): Array<TransitionQueueItem> {
    const queue = this.transitions.get(type);
    if (!queue) {
      this.transitions.set(type, []);
      return this.transitions.get(type) ?? [];
    }
    return queue;
  }

  private handleTransitionCancelledEvent({ type }: { type: TransitionType }) {
    const transitions = this.getQueue(type);
    while (transitions.length) transitions.pop();

    const ongoingTransition = this.ongoingTransitions.get(type);
    if (ongoingTransition) {
      ongoingTransition.cancelled = true;
      ongoingTransition.onTransitionCancelled?.();
      this.ongoingTransitions.delete(type);
    }
  }

  private emitTransitionProgress(type: TransitionType, progress: number) {
    this.eventEmitter.emit('transitionProgressed', { type, progress });
  }

  private emitTransitionFinished(type: TransitionType) {
    this.eventEmitter.emit('transitionFinished', { type });
  }
}
