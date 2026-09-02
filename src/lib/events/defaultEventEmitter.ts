import { Events } from '@/lib/events/topics';
import mitt from 'mitt';
import { EngineEventEmitter } from './engineEventEmitter';

export class DefaultEventEmitter implements EngineEventEmitter<Events> {
  private readonly emitter = mitt<Events>();

  emit<Key extends keyof Events>(type: Key, payload: Events[Key]): void {
    this.emitter.emit(type, payload);
  }

  off<Key extends keyof Events>(type: Key, handler?: (payload: Events[Key]) => void): void {
    this.emitter.off(type, handler);
  }

  on<Key extends keyof Events>(type: Key, handler: (payload: Events[Key]) => void): void {
    this.emitter.on(type, handler);
  }

  once<Key extends keyof Events>(type: Key, handler: (payload: Events[Key]) => void): void {
    const wrappedHandler = (payload: Events[Key]) => {
      this.emitter.off(type, wrappedHandler);
      handler(payload);
    };
    this.emitter.on(type, wrappedHandler);
  }

  dispose(): void {
    this.emitter.all.clear();
  }
}
