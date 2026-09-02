import { describe, expect, it, vi } from 'vitest';
import { DefaultEventEmitter } from './defaultEventEmitter';

describe('DefaultEventEmitter', () => {
  it('emits and removes event handlers', () => {
    const emitter = new DefaultEventEmitter();
    const handler = vi.fn();

    emitter.on('invalidRequest', handler);
    emitter.emit('invalidRequest', { message: 'first' });
    emitter.off('invalidRequest', handler);
    emitter.emit('invalidRequest', { message: 'second' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ message: 'first' });
  });

  it('runs once handlers once', () => {
    const emitter = new DefaultEventEmitter();
    const handler = vi.fn();

    emitter.once('invalidRequest', handler);
    emitter.emit('invalidRequest', { message: 'first' });
    emitter.emit('invalidRequest', { message: 'second' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ message: 'first' });
  });

  it('disposes all handlers', () => {
    const emitter = new DefaultEventEmitter();
    const handler = vi.fn();

    emitter.on('invalidRequest', handler);
    emitter.dispose();
    emitter.emit('invalidRequest', { message: 'ignored' });

    expect(handler).not.toHaveBeenCalled();
  });
});
