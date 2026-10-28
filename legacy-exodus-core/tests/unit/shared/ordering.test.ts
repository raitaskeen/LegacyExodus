import { describe, expect, it } from "bun:test";

import { compareCodePoints } from "@shared/ordering";

describe("compareCodePoints", () => {
  it("is a total order that returns 0 only for identical strings", () => {
    expect(compareCodePoints("a", "a")).toBe(0);
    expect(compareCodePoints("ä", "ä")).not.toBe(0);
    expect(compareCodePoints("B", "a")).toBe(-1);
    expect(compareCodePoints("a", "B")).toBe(1);
    expect(["b", "_", "A", "a", "Z"].sort(compareCodePoints)).toEqual(["A", "Z", "_", "a", "b"]);
  });
});
