import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { FREEZE_ARRAYS, immutable, isImmutable } from "@shared/immutability";

const helper = join(import.meta.dir, "../../../src/shared/immutability.ts").replace(/\\/g, "/");

function outside(environment: Record<string, string | undefined>): Record<string, boolean> {
  const script = `
    const { FREEZE_ARRAYS, immutable, isImmutable } = await import(${JSON.stringify(helper)});
    const array = immutable([1]);
    const object = immutable({ a: 1 });
    console.log(JSON.stringify({
      freezeArrays: FREEZE_ARRAYS,
      arrayFrozen: Object.isFrozen(array),
      arrayImmutable: isImmutable(array),
      plainArrayImmutable: isImmutable([1]),
      objectFrozen: Object.isFrozen(object),
      objectImmutable: isImmutable(object),
    }));`;
  const result = Bun.spawnSync(["bun", "-e", script], { env: { ...process.env, ...environment } as Record<string, string> });
  return JSON.parse(result.stdout.toString().trim()) as Record<string, boolean>;
}

describe("DAT-01 immutability with arrays left unfrozen outside tests", () => {
  test("in tests every value is frozen, arrays included", () => {
    expect(FREEZE_ARRAYS).toBe(true);
    const array = immutable([1, 2]);
    expect(Object.isFrozen(array)).toBe(true);
    expect(isImmutable(array)).toBe(true);
    expect(isImmutable([1, 2])).toBe(false);
  });

  test("in production objects are frozen and arrays are recorded, so isImmutable answers as isFrozen would", () => {
    expect(outside({ NODE_ENV: "production", LEGACY_EXODUS_FREEZE_ARRAYS: undefined })).toEqual({
      freezeArrays: false, arrayFrozen: false, arrayImmutable: true, plainArrayImmutable: false, objectFrozen: true, objectImmutable: true,
    });
  });

  test("LEGACY_EXODUS_FREEZE_ARRAYS=1 freezes arrays outside tests too", () => {
    expect(outside({ NODE_ENV: "production", LEGACY_EXODUS_FREEZE_ARRAYS: "1" })).toMatchObject({ freezeArrays: true, arrayFrozen: true, arrayImmutable: true });
  });
});
