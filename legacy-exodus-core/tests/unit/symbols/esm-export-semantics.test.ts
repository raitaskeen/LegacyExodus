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

  it("does not falsely report exported functions/variables as unreferenced dead code", async () => {
    const serviceCode = `
      function exportedFunction(val) {
        return val + 1;
      }
      const exportedConfig = { port: 8080 };
      export default exportedFunction;
      export { exportedConfig };
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

  it("propagates cross-file data flow and taint through export default identifier", async () => {
    const serviceCode = `
      function runCmd(cmd) {
        child_process.exec(cmd);
      }
      export default runCmd;
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
