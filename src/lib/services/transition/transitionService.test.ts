import { DefaultEventEmitter } from '@/lib/events';
import { describe, expect, it, vi } from 'vitest';
import { TransitionService } from './transitionService';

describe('TransitionService', () => {
  it('emits progress from start to finish', () => {
    const emitter = new DefaultEventEmitter();
    const service = new TransitionService(emitter);
    const onBegin = vi.fn();
    const onProgress = vi.fn();
    const onFinished = vi.fn();
    const progressed = vi.fn();
    const finished = vi.fn();

    emitter.on('transitionProgressed', progressed);
    emitter.on('transitionFinished', finished);
    service.enqueue(
      'mesh-sequence',
      { duration: 1000, easing: (n) => n },
      {
        onTransitionBegin: onBegin,
        onTransitionProgress: onProgress,
        onTransitionFinished: onFinished,
      },
    );

    service.compute(10);
    service.compute(10.5);
    service.compute(11);

    expect(onBegin).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith(0);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(onProgress).toHaveBeenCalledWith(1);
    expect(progressed).toHaveBeenCalledWith({ type: 'mesh-sequence', progress: 1 });
    expect(finished).toHaveBeenCalledWith({ type: 'mesh-sequence' });
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it('cancels queued and ongoing transitions once', () => {
    const emitter = new DefaultEventEmitter();
    const service = new TransitionService(emitter);
    const onCancelled = vi.fn();
    const onFinished = vi.fn();
    const queuedProgress = vi.fn();

    service.enqueue(
      'mesh-sequence',
      { duration: 1000, easing: (n) => n },
      {
        onTransitionCancelled: onCancelled,
        onTransitionFinished: onFinished,
      },
    );
    service.enqueue(
      'mesh-sequence',
      { duration: 1000, easing: (n) => n },
      {
        onTransitionProgress: queuedProgress,
      },
    );

    service.compute(1);
    emitter.emit('transitionCancelled', { type: 'mesh-sequence' });
    service.compute(2);

    expect(onCancelled).toHaveBeenCalledOnce();
    expect(onFinished).not.toHaveBeenCalled();
    expect(queuedProgress).not.toHaveBeenCalled();
  });
});
