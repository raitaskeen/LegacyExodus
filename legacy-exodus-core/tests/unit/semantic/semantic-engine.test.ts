import { describe, expect, test } from "bun:test";

import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

describe("DeterministicSemanticAnalysisEngine", () => {
  test("derives deterministic calls, references, scopes, findings, entry points, routes, and middleware", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const files = [
      { id: "server", path: "src/server.js", language: "javascript", size: 1 },
      { id: "auth", path: "src/auth.js", language: "javascript", size: 1 },
    ] as const;
    const serverSource = `
      import { login } from "./auth";
      const unused = true;
      function handler() { return login(); }
      const app = express();
      app.use(authenticate);
      app.get("/books", authenticate, handler);
      app.listen(3000);
    `;
    const authSource = "export function login() { return true; }";
    const serverAst = (await parser.parse({ file: files[0], source: serverSource })).result;
    const authAst = (await parser.parse({ file: files[1], source: authSource })).result;
    const serverSymbols = extractor.extract(serverAst);
    const authSymbols = extractor.extract(authAst);
    const dependencyGraph = new DeterministicDependencyGraphBuilder().build([serverSymbols, authSymbols], files);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({
      astResults: [serverAst, authAst],
      dependencyGraph,
      symbolTables: [serverSymbols, authSymbols],
    });

    expect(analysis.calls.some((call) => call.callerName === "handler" && call.calleeName === "login" && call.targetSymbolId !== undefined)).toBe(true);
    expect(analysis.references.some((reference) => reference.name === "login" && reference.resolvedSymbolId !== undefined)).toBe(true);
    expect(analysis.scopes[0]?.name).toBe("module");
    expect(analysis.deadCode.some((finding) => finding.name === "unused")).toBe(true);
    expect(analysis.entryPoints.some((entry) => entry.filePath === "src/server.js")).toBe(true);
    expect(analysis.routes).toEqual([expect.objectContaining({ filePath: "src/server.js", method: "GET", path: "/books" })]);
    expect(analysis.middlewareChains).toEqual([expect.objectContaining({ filePath: "src/server.js", middleware: ["authenticate"] })]);
    expect(analysis.calls.map((call) => call.id)).toEqual([...analysis.calls].map((call) => call.id).sort());
    expect(Object.isFrozen(analysis)).toBe(true);
  });
});
