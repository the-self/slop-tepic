// js/core/events.ts
// A typed event bus: the systems that report something (a crash, a knock-down) emit it, and the ones that react (the
// audio, the player's health, the HUD) subscribe, without either importing the other. The event map names every event
// and its payload, so a typo or a wrong payload is a compile error. emit() allocates nothing: hand it an object the
// emitter already has (an impact record it reuses) when the event can fire every frame.

type Handler<T> = (payload: T) => void;

export class EventBus<Events extends object> {
  private readonly handlers = new Map<keyof Events, Handler<never>[]>();

  /** Calls `handler` on every `type` event from now on; the returned function unsubscribes it */
  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let list = this.handlers.get(type);
    if (!list) this.handlers.set(type, list = []);
    list.push(handler);
    return () => {
      const at = list.indexOf(handler);
      if (at >= 0) list.splice(at, 1);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.handlers.get(type) as Handler<Events[K]>[] | undefined;
    if (!list) return;
    for (const handler of list) handler(payload);
  }
}
