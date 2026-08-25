import type { DomainEvent } from "./domain-event";

export type EventHandler = (event: DomainEvent) => void;

export class EventBus {
  private readonly handlersByType = new Map<string, EventHandler[]>();

  public subscribe(eventType: string, handler: EventHandler): () => void {
    const handlers = this.handlersByType.get(eventType) ?? [];

    handlers.push(handler);
    this.handlersByType.set(eventType, handlers);

    return (): void => {
      const registeredHandlers = this.handlersByType.get(eventType);

      if (registeredHandlers === undefined) {
        return;
      }

      const index = registeredHandlers.indexOf(handler);

      if (index >= 0) {
        registeredHandlers.splice(index, 1);
      }
    };
  }

  public publish(event: DomainEvent): void {
    const handlers = this.handlersByType.get(event.type);

    if (handlers === undefined || handlers.length === 0) {
      return;
    }

    const snapshot = [...handlers];

    for (const handler of snapshot) {
      handler(event);
    }
  }
}
