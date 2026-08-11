import { describe, expect, test } from "bun:test";

import { ProjectStatus } from "@core/state/project-state";
import { createProjectState } from "@core/state/state-factory";
import { validateProjectState } from "@core/state/state-schema";
import { LegacyExodusError } from "@shared/errors";

describe("ProjectState", () => {
  test("creates an initialized canonical project state", (): void => {
    const state = createProjectState("Legacy billing system");

    expect(state.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(state.name).toBe("Legacy billing system");
    expect(state.status).toBe(ProjectStatus.INITIALIZED);
    expect(state.version).toBe(0);
    expect(state.createdAt).toBeInstanceOf(Date);
    expect(state.updatedAt.getTime()).toBe(state.createdAt.getTime());
    expect(Object.isFrozen(state)).toBe(true);
  });

  test("rejects invalid project state", (): void => {
    expect(() =>
      validateProjectState({
        id: "invalid-id",
        name: "",
        version: -1,
        status: "UNKNOWN",
        metadata: {},
        artifacts: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow(LegacyExodusError);
  });
});
