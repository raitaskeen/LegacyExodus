import { describe, expect, test } from "bun:test";

import {
  createDomainEvent,
  type DomainEvent,
} from "@core/events/domain-event";
import type { FileDiscoveredPayload } from "@contracts/events";

describe("DomainEvent", () => {
  test("creates an immutable fact event with the required structure", (): void => {
    const event: DomainEvent<FileDiscoveredPayload> = createDomainEvent({
      type: "FileDiscovered",
      aggregateId: "project-123",
      payload: {
        fileId: "file-123",
        path: "src/legacy.php",
        language: "PHP",
      },
    });

    expect(event.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(event.timestamp).toBeInstanceOf(Date);
    expect(event.aggregateId).toBe("project-123");
    expect(event.type).toBe("FileDiscovered");
    expect(event.payload.path).toBe("src/legacy.php");
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(Reflect.set(event.payload, "path", "changed.php")).toBe(false);
    expect(event.payload.path).toBe("src/legacy.php");
  });
});
