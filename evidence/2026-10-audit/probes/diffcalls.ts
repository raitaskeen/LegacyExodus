import { readFileSync } from "node:fs";
const [a, b] = process.argv.slice(2);
const load = (p: string) => JSON.parse(readFileSync(`${p}/.discovery/semantic.json`, "utf8")).calls as any[];
const after = new Map(load(b!).map((c) => [c.id, c]));
const lost = load(a!).filter((c) => c.resolutionState === "RESOLVED" && after.get(c.id)?.resolutionState !== "RESOLVED");
const byShape = new Map<string, number>();
for (const c of lost) { const k = c.calleeName.includes(".") ? (c.calleeName.startsWith("this.") ? "this.*" : "x.m") : "f()"; byShape.set(k, (byShape.get(k) ?? 0) + 1); }
const byFile = new Map<string, number>();
for (const c of lost) byFile.set(c.sourceFilePath, (byFile.get(c.sourceFilePath) ?? 0) + 1);
const byName = new Map<string, number>();
for (const c of lost) byName.set(c.calleeName, (byName.get(c.calleeName) ?? 0) + 1);
console.log("lost", lost.length, JSON.stringify([...byShape]));
console.log("top files", JSON.stringify([...byFile].sort((x, y) => y[1] - x[1]).slice(0, 8)));
console.log("top names", JSON.stringify([...byName].sort((x, y) => y[1] - x[1]).slice(0, 12)));
