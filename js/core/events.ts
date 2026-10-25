// js/core/events.ts
// A typed event bus: the systems that report something (a crash, a knock-down) emit it, and the ones that react (the
// audio, the player's health, the HUD) subscribe, without either importing the other. The event map names every event
// and its payload, so a typo or a wrong payload is a compile error. emit() allocates nothing: hand it an object the
// emitter already has (an impact record it reuses) when the event can fire every frame.

type Handler<T> = (payload: T) => void;

export class EventBus<Events extends object> {
  private readonly handlers = new Map<keyof Events, Handler<never>[]>();

  /** Calls `handler` on every `type` event from now on; the returned function unsubscribes it */
  // (Subscribing and unsubscribing replace a type's list instead of changing it: an emit() under way keeps walking
  // the list it started with, so a handler that unsubscribes itself doesn't make the next one miss the event.)
  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
    return () => {
      const list = this.handlers.get(type);
      if (list) this.handlers.set(type, list.filter((h) => h !== handler));
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.handlers.get(type) as Handler<Events[K]>[] | undefined;
    if (!list) return;
    for (const handler of list) handler(payload);
  }
}
