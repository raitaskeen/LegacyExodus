import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLegacyExodusEngine } from "@runtime/composition/services";
import { JavaScriptParser } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";
import type { SemanticAnalysis } from "@semantic/index";

describe("F08 public AnalyzeProject persisted lexical evidence", () => {
  test("used local has exact persisted reference while unused local remains inferred", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "lx-f08-"));
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    try {
      const source = "function demo() { const used = 1; const unused = 2; return used; } demo();";
      await writeFile(join(projectPath, "package.json"), JSON.stringify({ name: "f08", version: "1.0.0" }));
      await writeFile(join(projectPath, "index.js"), source);
      await engine.initialize();
      const result = await engine.execute({ id: randomUUID(), type: "AnalyzeProject", createdAt: new Date(), payload: { projectId: randomUUID(), path: projectPath } });
      expect(result.type).toBe("AnalyzeProject");
      if (result.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(result.analysis.parserFailures).toBe(0);
      expect(result.analysis.symbolExtractionFailures).toBe(0);
      const persisted = JSON.parse(await readFile(join(projectPath, ".discovery", "semantic.json"), "utf8")) as SemanticAnalysis;
      const file = { id: "f08", path: "index.js", language: "javascript", size: source.length };
      const ast = (await new JavaScriptParser().parse({ file, source })).result;
      const symbols = new JavaScriptSymbolExtractor().extract(ast).symbols;
      const used = symbols.find(s => s.name === "used" && s.kind === "variable")!;
      const unused = symbols.find(s => s.name === "unused" && s.kind === "variable")!;
      expect(used).toBeDefined(); expect(unused).toBeDefined();
      expect(persisted.references.filter(r => r.kind === "identifier" && r.resolvedSymbolId === used.id)).toEqual([expect.objectContaining({
        filePath: "index.js", name: "used", resolutionState: "RESOLVED", resolvedSymbolId: used.id,
      })]);
      expect(persisted.deadCode.filter(d => d.symbolId === used.id)).toEqual([]);
      expect(persisted.deadCode.filter(d => d.symbolId === unused.id)).toEqual([expect.objectContaining({ reason: "unreferenced-local-symbol", state: "INFERRED" })]);
    } finally {
      await engine.shutdown();
      await rm(projectPath, { recursive: true, force: true });
    }
  });
});
