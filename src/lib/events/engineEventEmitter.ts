export interface EngineEventEmitter<EventMap extends Record<string, unknown>> {
  emit<Key extends keyof EventMap>(type: Key, payload: EventMap[Key]): void;

  off<Key extends keyof EventMap>(type: Key, handler?: (payload: EventMap[Key]) => void): void;

  on<Key extends keyof EventMap>(type: Key, handler: (payload: EventMap[Key]) => void): void;

  once<Key extends keyof EventMap>(type: Key, handler: (payload: EventMap[Key]) => void): void;

  dispose(): void;
}
