import { describe, expect, it } from "bun:test";
import { compareCodePoints, sortByKey } from "@shared/ordering";

describe("BA-17 sortByKey", () => {
  const items = [
    { id: "b", n: 1 }, { id: "a", n: 2 }, { id: "b", n: 3 }, { id: "Á", n: 4 }, { id: "a", n: 5 }, { id: "", n: 6 },
  ];

  it("orders like a code-point comparator on the same key, stably", () => {
    const expected = [...items].sort((left, right) => compareCodePoints(left.id, right.id));
    expect(sortByKey(items, (item) => item.id)).toEqual(expected);
  });

  it("computes each key once and leaves its input untouched", () => {
    let calls = 0;
    const input = Object.freeze([...items]);
    sortByKey(input, (item) => { calls++; return item.id; });
    expect(calls).toBe(items.length);
    expect(input).toEqual(items);
  });
});
