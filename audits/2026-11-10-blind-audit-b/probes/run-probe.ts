// Temporary audit helper (not committed): analyse a probe folder and print facts.
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLegacyExodusEngine } from "@runtime/composition/services";
import { extractFacts } from "./fact-diff";
const [dir, ...cats] = process.argv.slice(2);
const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
await engine.initialize();
const ws = await mkdtemp(join(tmpdir(), "lx-probe-"));
await cp(resolve(dir!), ws, { recursive: true });
await engine.execute({ id: randomUUID(), type: "AnalyzeProject", createdAt: new Date(), payload: { projectId: randomUUID(), path: ws, refresh: true } });
const facts = extractFacts(join(ws, ".discovery"));
for (const [cat, set] of facts) if (cats.length === 0 ? cat === "calls" : cats.includes(cat) || cats.includes("ALL")) for (const f of [...set].sort()) console.log(cat + "  " + f);
await engine.shutdown();
await rm(ws, { recursive: true, force: true });
