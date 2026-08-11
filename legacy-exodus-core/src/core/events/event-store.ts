import type { DomainEvent } from "./domain-event";

export class InMemoryEventStore {
  private readonly events: DomainEvent[] = [];

  public append(event: DomainEvent): void {
    this.events.push(event);
  }

  public getAll(): readonly DomainEvent[] {
    return [...this.events];
  }

  public getByType(type: string): readonly DomainEvent[] {
    return this.events.filter((event) => event.type === type);
  }

  public size(): number {
    return this.events.length;
  }

  public clear(): void {
    this.events.length = 0;
  }
}
