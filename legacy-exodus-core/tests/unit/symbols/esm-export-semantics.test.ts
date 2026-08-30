import { describe, expect, it } from "bun:test";
import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";
import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { DeterministicSemanticAnalysisEngine } from "@semantic/semantic-engine";
import { DeterministicFlowAnalysisEngine } from "@flow/flow-analysis-engine";

describe("F-011 ESM Export Semantics & Downstream Resolution Integrity", () => {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const depGraphBuilder = new DeterministicDependencyGraphBuilder();
  const semanticEngine = new DeterministicSemanticAnalysisEngine();
  const flowEngine = new DeterministicFlowAnalysisEngine();

  async function extractFromSource(code: string, path = "test.js") {
    const parseRes = await parser.parse({
      file: {
        id: "test-file-id",
        path,
        language: path.endsWith(".ts") ? "typescript" : "javascript",
        size: code.length,
        fileKind: "source",
      },
      source: code,
    });
    return extractor.extract(parseRes.result);
  }

  // --- Declaration before Export (Reverse / Standard Order) ---

  it("marks local symbol as exported for export { foo }", async () => {
    const code = `
      const foo = 1;
      export { foo };
    `;
    const table = await extractFromSource(code);
    const fooVar = table.symbols.find((s) => s.name === "foo" && s.kind === "variable");
    const fooExport = table.symbols.find((s) => s.name === "foo" && s.kind === "export");

    expect(fooVar).toBeDefined();
    expect(fooVar?.exported).toBe(true);
    expect(fooExport).toBeDefined();
    expect(fooExport?.sourceSymbolName).toBe("foo");
    expect(fooExport?.defaultExport).toBe(false);
  });

  it("marks local symbol as exported for aliased export { foo as bar }", async () => {
    const code = `
      function foo() {}
      export { foo as bar };
    `;
    const table = await extractFromSource(code);
    const fooFn = table.symbols.find((s) => s.name === "foo" && s.kind === "function");
    const barExport = table.symbols.find((s) => s.name === "bar" && s.kind === "export");

    expect(fooFn).toBeDefined();
    expect(fooFn?.exported).toBe(true);
    expect(barExport).toBeDefined();
    expect(barExport?.name).toBe("bar");
    expect(barExport?.sourceSymbolName).toBe("foo");
    expect(barExport?.defaultExport).toBe(false);
  });

  it("marks local symbol as exported for export { foo as default }", async () => {
    const code = `
      class FooService {}
      export { FooService as default };
    `;
    const table = await extractFromSource(code);
    const cls = table.symbols.find((s) => s.name === "FooService" && s.kind === "class");
    const defExport = table.symbols.find((s) => s.name === "default" && s.kind === "export");

    expect(cls).toBeDefined();
    expect(cls?.exported).toBe(true);
    expect(defExport).toBeDefined();
    expect(defExport?.defaultExport).toBe(true);
    expect(defExport?.sourceSymbolName).toBe("FooService");
  });

  it("marks local symbol as exported and records sourceSymbolName for export default identifier", async () => {
    const code = `
      function calculateTotal(items) {
        return items.length;
      }
      export default calculateTotal;
    `;
    const table = await extractFromSource(code);
    const fn = table.symbols.find((s) => s.name === "calculateTotal" && s.kind === "function");
    const defExport = table.symbols.find((s) => s.name === "default" && s.kind === "export");

    expect(fn).toBeDefined();
    expect(fn?.exported).toBe(true);
    expect(defExport).toBeDefined();
    expect(defExport?.defaultExport).toBe(true);
    expect(defExport?.sourceSymbolName).toBe("calculateTotal");
  });

  // --- Forward References (Export before Declaration) ---

  it("resolves forward-referenced local export binding for export { handler } before function declaration", async () => {
    const code = `
      export { handler };
      function handler() {}
    `;
    const table = await extractFromSource(code);
    const fn = table.symbols.find((s) => s.name === "handler" && s.kind === "function");
    const exp = table.symbols.find((s) => s.name === "handler" && s.kind === "export");

    expect(fn).toBeDefined();
    expect(fn?.exported).toBe(true);
    expect(exp).toBeDefined();
    expect(exp?.sourceSymbolName).toBe("handler");
    expect(exp?.defaultExport).toBe(false);
  });

  it("resolves forward-referenced local export binding for export default handler before function declaration", async () => {
    const code = `
      export default handler;
      function handler() {}
    `;
    const table = await extractFromSource(code);
    const fn = table.symbols.find((s) => s.name === "handler" && s.kind === "function");
    const exp = table.symbols.find((s) => s.name === "default" && s.kind === "export");

    expect(fn).toBeDefined();
    expect(fn?.exported).toBe(true);
    expect(exp).toBeDefined();
    expect(exp?.defaultExport).toBe(true);
    expect(exp?.sourceSymbolName).toBe("handler");
  });

  it("resolves forward-referenced local export binding for aliased export { handler as runHandler } before function declaration", async () => {
    const code = `
      export { handler as runHandler };
      function handler() {}
    `;
    const table = await extractFromSource(code);
    const fn = table.symbols.find((s) => s.name === "handler" && s.kind === "function");
    const exp = table.symbols.find((s) => s.name === "runHandler" && s.kind === "export");

    expect(fn).toBeDefined();
    expect(fn?.exported).toBe(true);
    expect(exp).toBeDefined();
    expect(exp?.name).toBe("runHandler");
    expect(exp?.sourceSymbolName).toBe("handler");
  });

  it("resolves forward-referenced local export binding for default alias export { handler as default } before class declaration", async () => {
    const code = `
      export { HandlerService as default };
      class HandlerService {}
    `;
    const table = await extractFromSource(code);
    const cls = table.symbols.find((s) => s.name === "HandlerService" && s.kind === "class");
    const exp = table.symbols.find((s) => s.name === "default" && s.kind === "export");

    expect(cls).toBeDefined();
    expect(cls?.exported).toBe(true);
    expect(exp).toBeDefined();
    expect(exp?.defaultExport).toBe(true);
    expect(exp?.sourceSymbolName).toBe("HandlerService");
  });

  // --- Scope Safety and Isolation ---

  it("preserves scope isolation when forward-referenced export matches module-level binding over nested function", async () => {
    const code = `
      export { handler };

      function wrapper() {
        function handler() {}
      }
      function handler() {}
    `;
    const table = await extractFromSource(code);
    const moduleFn = table.symbols.find(
      (s) => s.name === "handler" && s.kind === "function" && s.scopeId === "scope:module",
    );
    const nestedFn = table.symbols.find(
      (s) => s.name === "handler" && s.kind === "function" && s.scopeId !== "scope:module",
    );

    expect(moduleFn).toBeDefined();
    expect(moduleFn?.exported).toBe(true);
    expect(nestedFn).toBeDefined();
    expect(nestedFn?.exported).toBe(false);
  });

  it("does not mark local symbols as exported for forward re-exports", async () => {
    const code = `
      export { handler } from "./other";
      function handler() {}
    `;
    const table = await extractFromSource(code);
    const localFn = table.symbols.find((s) => s.name === "handler" && s.kind === "function");
    const exp = table.symbols.find((s) => s.name === "handler" && s.kind === "export");

    expect(localFn).toBeDefined();
    expect(localFn?.exported).toBe(false);
    expect(exp).toBeDefined();
    expect(exp?.moduleSpecifier).toBe("./other");
  });

  it("does not fabricate local symbols for forward exports referencing undefined names", async () => {
    const code = `
      export { missing };
      export default nonExistent;
    `;
    const table = await extractFromSource(code);
    expect(table.symbols.length).toBe(2);
    expect(table.symbols.every((s) => s.kind === "export")).toBe(true);
  });

  // --- Inline Export Declarations ---

  it("records sourceSymbolName for export default function declaration", async () => {
    const code = `
      export default function handler(req, res) {
        res.send("ok");
      }
    `;
    const table = await extractFromSource(code);
    const fn = table.symbols.find((s) => s.name === "handler" && s.kind === "function");
    const defExport = table.symbols.find((s) => s.name === "default" && s.kind === "export");

    expect(fn).toBeDefined();
    expect(fn?.exported).toBe(true);
    expect(defExport).toBeDefined();
    expect(defExport?.defaultExport).toBe(true);
    expect(defExport?.sourceSymbolName).toBe("handler");
  });

  it("records sourceSymbolName for export default class declaration", async () => {
    const code = `
      export default class AppServer {
        start() {}
      }
    `;
    const table = await extractFromSource(code);
    const cls = table.symbols.find((s) => s.name === "AppServer" && s.kind === "class");
    const defExport = table.symbols.find((s) => s.name === "default" && s.kind === "export");

    expect(cls).toBeDefined();
    expect(cls?.exported).toBe(true);
    expect(defExport).toBeDefined();
    expect(defExport?.defaultExport).toBe(true);
    expect(defExport?.sourceSymbolName).toBe("AppServer");
  });

  it("handles anonymous export default function safely", async () => {
    const code = `
      export default function(req, res) {}
    `;
    const table = await extractFromSource(code);
    const defExport = table.symbols.find((s) => s.name === "default" && s.kind === "export");

    expect(defExport).toBeDefined();
    expect(defExport?.defaultExport).toBe(true);
    expect(defExport?.sourceSymbolName).toBeUndefined();
  });

  it("handles literal export default expression safely", async () => {
    const code = `
      export default 42;
    `;
    const table = await extractFromSource(code);
    const defExport = table.symbols.find((s) => s.name === "default" && s.kind === "export");

    expect(defExport).toBeDefined();
    expect(defExport?.defaultExport).toBe(true);
    expect(defExport?.sourceSymbolName).toBeUndefined();
  });

  it("re-exports from another module retain moduleSpecifier and sourceSymbolName", async () => {
    const code = `
      export { helper as utilHelper } from "./utils";
      export * from "./common";
      export * as ns from "./tools";
    `;
    const table = await extractFromSource(code);
    const expNamed = table.symbols.find((s) => s.name === "utilHelper");
    const expWildcard = table.symbols.find((s) => s.name === "*");
    const expNamespace = table.symbols.find((s) => s.name === "ns");

    expect(expNamed?.moduleSpecifier).toBe("./utils");
    expect(expNamed?.sourceSymbolName).toBe("helper");

    expect(expWildcard?.moduleSpecifier).toBe("./common");
    expect(expWildcard?.name).toBe("*");

    expect(expNamespace?.moduleSpecifier).toBe("./tools");
    expect(expNamespace?.sourceSymbolName).toBe("*");
  });

  // --- Downstream Semantic and Flow Verifications ---

  it("does not falsely report exported functions/variables as unreferenced dead code", async () => {
    const serviceCode = `
      export default exportedFunction;
      export { exportedConfig };
      function exportedFunction(val) {
        return val + 1;
      }
      const exportedConfig = { port: 8080 };
    `;
    const serviceFile = { id: "f-srv", path: "src/srv.js", language: "javascript", size: serviceCode.length };
    const ast = (await parser.parse({ file: serviceFile, source: serviceCode })).result;
    const symbols = extractor.extract(ast);
    const depGraph = depGraphBuilder.build([symbols], [serviceFile]);

    const semantic = semanticEngine.analyze({
      astResults: [ast],
      symbolTables: [symbols],
      dependencyGraph: depGraph,
    });

    const deadFn = semantic.deadCode.find((d) => d.name === "exportedFunction");
    const deadConfig = semantic.deadCode.find((d) => d.name === "exportedConfig");

    expect(deadFn).toBeUndefined();
    expect(deadConfig).toBeUndefined();
  });

  it("propagates cross-file data flow and taint through forward-referenced export default identifier", async () => {
    const serviceCode = `
      export default runCmd;
      function runCmd(cmd) {
        child_process.exec(cmd);
      }
    `;
    const consumerCode = `
      import runCmd from "./service";
      const payload = req.body.command;
      runCmd(payload);
    `;

    const files = [
      { id: "f-service", path: "src/service.js", language: "javascript", size: serviceCode.length },
      { id: "f-consumer", path: "src/consumer.js", language: "javascript", size: consumerCode.length },
    ] as const;

    const [serviceAst, consumerAst] = await Promise.all([
      parser.parse({ file: files[0], source: serviceCode }).then((r) => r.result),
      parser.parse({ file: files[1], source: consumerCode }).then((r) => r.result),
    ]);

    const serviceSymbols = extractor.extract(serviceAst);
    const consumerSymbols = extractor.extract(consumerAst);

    const depGraph = depGraphBuilder.build([serviceSymbols, consumerSymbols], files);
    const semantic = semanticEngine.analyze({
      astResults: [serviceAst, consumerAst],
      symbolTables: [serviceSymbols, consumerSymbols],
      dependencyGraph: depGraph,
    });

    const flow = flowEngine.analyze([serviceAst, consumerAst], semantic.calls, [serviceSymbols, consumerSymbols]);
    const serviceDfg = flow.dataFlowGraphs.find((g) => g.filePath === "src/service.js");

    expect(serviceDfg).toBeDefined();
    expect(serviceDfg?.taintFlows.length).toBe(1);
    expect(serviceDfg?.taintFlows[0]?.state).toBe("CONFIRMED");
    expect(serviceDfg?.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });
});
