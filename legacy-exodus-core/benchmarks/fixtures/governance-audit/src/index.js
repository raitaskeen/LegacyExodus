import { formatResult } from "./format.js";
import { add, square, sumOf } from "./math.js";

export function summarize(values) {
  const total = sumOf(values);
  const squares = values.map((value) => square(value));
  const lines = [formatResult("total", total), formatResult("squares", sumOf(squares))];
  if (total > 10) {
    lines.push(formatResult("bonus", add(total, 1)));
  }
  return lines.join("\n");
}

export function main() {
  return summarize([1, 2, 3, 4]);
}
