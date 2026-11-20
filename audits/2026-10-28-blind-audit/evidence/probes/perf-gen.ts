// Generates single-file repositories of growing size to test how per-file analysis cost
// scales (doubling N should roughly double time for linear algorithms).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const sizes = (process.argv[2] ?? "500,1000,2000,4000").split(",").map(Number);
for (const n of sizes) {
  const dir = `C:/Projects/.audit/perf/n${n}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const lines: string[] = ["let acc = 0;"];
  for (let i = 0; i < n; i++) {
    lines.push(`function f${i}(a, b) { const c = a + b + ${i}; if (c > ${i}) { acc = acc + c; } return g${i % 7}(c); }`);
  }
  for (let i = 0; i < 7; i++) lines.push(`function g${i}(x) { return x * ${i + 1}; }`);
  for (let i = 0; i < n; i++) lines.push(`acc = f${i}(acc, ${i});`);
  lines.push("export default acc;");
  writeFileSync(`${dir}/big.js`, lines.join("\n") + "\n");
}
