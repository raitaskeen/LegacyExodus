import { describe, expect, it } from "bun:test";
import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";
import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { DeterministicSemanticAnalysisEngine } from "@semantic/semantic-engine";
import { DeterministicCallGraphBuilder } from "@semantic/call-graph-builder";

describe("Semantic Call-Graph Lexical Shadowing Precision", () => {
  it("honors parameter shadowing of a named import", async () => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const depBuilder = new DeterministicDependencyGraphBuilder();
    const callGraphBuilder = new DeterministicCallGraphBuilder();
    const engine = new DeterministicSemanticAnalysisEngine(callGraphBuilder);

    const billingSource = `export function charge() { return "charged"; }`;
    const clientSource = `
      import { charge } from "./billing";

      function run(charge) {
        charge();
      }

      function normal() {
        charge();
      }
    `;

    const billingFile = { id: "f1", path: "src/billing.js", language: "javascript", size: billingSource.length };
    const clientFile = { id: "f2", path: "src/client.js", language: "javascript", size: clientSource.length };

    const billingAst = (await parser.parse({ file: billingFile, source: billingSource })).result!;
    const clientAst = (await parser.parse({ file: clientFile, source: clientSource })).result!;

    const billingSymbols = extractor.extract(billingAst);
    const clientSymbols = extractor.extract(clientAst);

    const depGraph = depBuilder.build([billingSymbols, clientSymbols], [billingFile, clientFile]);
    const analysis = engine.analyze({
      astResults: [billingAst, clientAst],
      dependencyGraph: depGraph,
      symbolTables: [billingSymbols, clientSymbols],
    });

    const chargeExportSymbol = billingSymbols.symbols.find((s) => s.kind === "export" && s.name === "charge");
    expect(chargeExportSymbol).toBeDefined();

    const shadowedCall = analysis.calls.find((c) => c.callerName === "run" && c.calleeName === "charge");
    expect(shadowedCall).toBeDefined();
    // Parameter shadows import: must NOT resolve to imported billing.charge!
    expect(shadowedCall?.targetSymbolId).toBeUndefined();
    expect(shadowedCall?.resolutionState).toBe("UNRESOLVED");

    const normalCall = analysis.calls.find((c) => c.callerName === "normal" && c.calleeName === "charge");
    expect(normalCall).toBeDefined();
    // Non-shadowed call must resolve to imported billing.charge
    expect(normalCall?.targetSymbolId).toBe(chargeExportSymbol?.id);
    expect(normalCall?.resolutionState).toBe("RESOLVED");
  });

  it("honors parameter shadowing of a namespace import receiver", async () => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const depBuilder = new DeterministicDependencyGraphBuilder();
    const callGraphBuilder = new DeterministicCallGraphBuilder();
    const engine = new DeterministicSemanticAnalysisEngine(callGraphBuilder);

    const billingSource = `export function charge() { return "charged"; }`;
    const clientSource = `
      import * as billing from "./billing";

      function run(billing) {
        billing.charge();
      }

      function normal() {
        billing.charge();
      }
    `;

    const billingFile = { id: "f1", path: "src/billing.js", language: "javascript", size: billingSource.length };
    const clientFile = { id: "f2", path: "src/client.js", language: "javascript", size: clientSource.length };

    const billingAst = (await parser.parse({ file: billingFile, source: billingSource })).result!;
    const clientAst = (await parser.parse({ file: clientFile, source: clientSource })).result!;

    const billingSymbols = extractor.extract(billingAst);
    const clientSymbols = extractor.extract(clientAst);

    const depGraph = depBuilder.build([billingSymbols, clientSymbols], [billingFile, clientFile]);
    const analysis = engine.analyze({
      astResults: [billingAst, clientAst],
      dependencyGraph: depGraph,
      symbolTables: [billingSymbols, clientSymbols],
    });

    const chargeExportSymbol = billingSymbols.symbols.find((s) => s.kind === "export" && s.name === "charge");
    expect(chargeExportSymbol).toBeDefined();

    const shadowedCall = analysis.calls.find((c) => c.callerName === "run" && c.calleeName === "billing.charge");
    expect(shadowedCall).toBeDefined();
    // Parameter shadows namespace: must NOT resolve to imported billing.charge!
    expect(shadowedCall?.targetSymbolId).toBeUndefined();
    expect(shadowedCall?.resolutionState).toBe("UNRESOLVED");

    const normalCall = analysis.calls.find((c) => c.callerName === "normal" && c.calleeName === "billing.charge");
    expect(normalCall).toBeDefined();
    // Non-shadowed call must resolve to imported billing.charge
    expect(normalCall?.targetSymbolId).toBe(chargeExportSymbol?.id);
    expect(normalCall?.resolutionState).toBe("RESOLVED");
  });

  it("honors inner function declaration shadowing of an import", async () => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const depBuilder = new DeterministicDependencyGraphBuilder();
    const callGraphBuilder = new DeterministicCallGraphBuilder();
    const engine = new DeterministicSemanticAnalysisEngine(callGraphBuilder);

    const helperSource = `export function helper() { return "imported"; }`;
    const clientSource = `
      import { helper } from "./helper";

      function run() {
        function helper() {
          return "local";
        }
        helper();
      }

      function normal() {
        helper();
      }
    `;

    const helperFile = { id: "f1", path: "src/helper.js", language: "javascript", size: helperSource.length };
    const clientFile = { id: "f2", path: "src/client.js", language: "javascript", size: clientSource.length };

    const helperAst = (await parser.parse({ file: helperFile, source: helperSource })).result!;
    const clientAst = (await parser.parse({ file: clientFile, source: clientSource })).result!;

    const helperSymbols = extractor.extract(helperAst);
    const clientSymbols = extractor.extract(clientAst);

    const depGraph = depBuilder.build([helperSymbols, clientSymbols], [helperFile, clientFile]);
    const analysis = engine.analyze({
      astResults: [helperAst, clientAst],
      dependencyGraph: depGraph,
      symbolTables: [helperSymbols, clientSymbols],
    });

    const helperExportSymbol = helperSymbols.symbols.find((s) => s.kind === "export" && s.name === "helper");
    expect(helperExportSymbol).toBeDefined();

    const localHelperSymbol = clientSymbols.symbols.find((s) => s.kind === "function" && s.name === "helper" && s.scopeId !== "scope:module");
    expect(localHelperSymbol).toBeDefined();

    const shadowedCall = analysis.calls.find((c) => c.callerName === "run" && c.calleeName === "helper");
    expect(shadowedCall).toBeDefined();
    // Inner function shadows import: must resolve to local function, NOT import!
    expect(shadowedCall?.targetSymbolId).toBe(localHelperSymbol?.id);
    expect(shadowedCall?.targetSymbolId).not.toBe(helperExportSymbol?.id);
    expect(shadowedCall?.resolutionState).toBe("RESOLVED");

    const normalCall = analysis.calls.find((c) => c.callerName === "normal" && c.calleeName === "helper");
    expect(normalCall).toBeDefined();
    expect(normalCall?.targetSymbolId).toBe(helperExportSymbol?.id);
    expect(normalCall?.resolutionState).toBe("RESOLVED");
  });

  it("honors nested lexical scope shadowing across multiple function levels", async () => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const depBuilder = new DeterministicDependencyGraphBuilder();
    const callGraphBuilder = new DeterministicCallGraphBuilder();
    const engine = new DeterministicSemanticAnalysisEngine(callGraphBuilder);

    const apiSource = `export function ping() { return "pong"; }`;
    const clientSource = `
      import * as api from "./api";

      function outer() {
        function middle(api) {
          function inner() {
            api.ping();
          }
          inner();
        }
        middle();
        api.ping();
      }
    `;

    const apiFile = { id: "f1", path: "src/api.js", language: "javascript", size: apiSource.length };
    const clientFile = { id: "f2", path: "src/client.js", language: "javascript", size: clientSource.length };

    const apiAst = (await parser.parse({ file: apiFile, source: apiSource })).result!;
    const clientAst = (await parser.parse({ file: clientFile, source: clientSource })).result!;

    const apiSymbols = extractor.extract(apiAst);
    const clientSymbols = extractor.extract(clientAst);

    const depGraph = depBuilder.build([apiSymbols, clientSymbols], [apiFile, clientFile]);
    const analysis = engine.analyze({
      astResults: [apiAst, clientAst],
      dependencyGraph: depGraph,
      symbolTables: [apiSymbols, clientSymbols],
    });

    const pingExportSymbol = apiSymbols.symbols.find((s) => s.kind === "export" && s.name === "ping");
    expect(pingExportSymbol).toBeDefined();

    // Inside inner(), api is shadowed by middle's parameter: must NOT resolve to import!
    const innerCall = analysis.calls.find((c) => c.callerName === "inner" && c.calleeName === "api.ping");
    expect(innerCall).toBeDefined();
    expect(innerCall?.targetSymbolId).toBeUndefined();
    expect(innerCall?.resolutionState).toBe("UNRESOLVED");

    // In outer(), api is NOT shadowed: must resolve to imported api.ping
    const outerCall = analysis.calls.find((c) => c.callerName === "outer" && c.calleeName === "api.ping");
    expect(outerCall).toBeDefined();
    expect(outerCall?.targetSymbolId).toBe(pingExportSymbol?.id);
    expect(outerCall?.resolutionState).toBe("RESOLVED");
  });

  it("honors local variable declaration shadowing of an import", async () => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const depBuilder = new DeterministicDependencyGraphBuilder();
    const callGraphBuilder = new DeterministicCallGraphBuilder();
    const engine = new DeterministicSemanticAnalysisEngine(callGraphBuilder);

    const billingSource = `export function charge() { return "charged"; }`;
    const clientSource = `
      import { charge } from "./billing";

      function run() {
        const charge = 42;
        charge();
      }

      function normal() {
        charge();
      }
    `;

    const billingFile = { id: "f1", path: "src/billing.js", language: "javascript", size: billingSource.length };
    const clientFile = { id: "f2", path: "src/client.js", language: "javascript", size: clientSource.length };

    const billingAst = (await parser.parse({ file: billingFile, source: billingSource })).result!;
    const clientAst = (await parser.parse({ file: clientFile, source: clientSource })).result!;

    const billingSymbols = extractor.extract(billingAst);
    const clientSymbols = extractor.extract(clientAst);

    const depGraph = depBuilder.build([billingSymbols, clientSymbols], [billingFile, clientFile]);
    const analysis = engine.analyze({
      astResults: [billingAst, clientAst],
      dependencyGraph: depGraph,
      symbolTables: [billingSymbols, clientSymbols],
    });

    const chargeExportSymbol = billingSymbols.symbols.find((s) => s.kind === "export" && s.name === "charge");
    expect(chargeExportSymbol).toBeDefined();

    const shadowedCall = analysis.calls.find((c) => c.callerName === "run" && c.calleeName === "charge");
    expect(shadowedCall).toBeDefined();
    // Non-callable local variable shadows import: must NOT resolve to import!
    expect(shadowedCall?.targetSymbolId).toBeUndefined();
    expect(shadowedCall?.resolutionState).toBe("UNRESOLVED");

    const normalCall = analysis.calls.find((c) => c.callerName === "normal" && c.calleeName === "charge");
    expect(normalCall).toBeDefined();
    expect(normalCall?.targetSymbolId).toBe(chargeExportSymbol?.id);
    expect(normalCall?.resolutionState).toBe("RESOLVED");
  });

  it("honors catch clause parameter shadowing of an import", async () => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const depBuilder = new DeterministicDependencyGraphBuilder();
    const callGraphBuilder = new DeterministicCallGraphBuilder();
    const engine = new DeterministicSemanticAnalysisEngine(callGraphBuilder);

    const billingSource = `export function charge() { return "charged"; }`;
    const clientSource = `
      import { charge } from "./billing";

      function run() {
        try {
          doWork();
        } catch (charge) {
          charge();
        }
      }

      function normal() {
        charge();
      }
    `;

    const billingFile = { id: "f1", path: "src/billing.js", language: "javascript", size: billingSource.length };
    const clientFile = { id: "f2", path: "src/client.js", language: "javascript", size: clientSource.length };

    const billingAst = (await parser.parse({ file: billingFile, source: billingSource })).result!;
    const clientAst = (await parser.parse({ file: clientFile, source: clientSource })).result!;

    const billingSymbols = extractor.extract(billingAst);
    const clientSymbols = extractor.extract(clientAst);

    const depGraph = depBuilder.build([billingSymbols, clientSymbols], [billingFile, clientFile]);
    const analysis = engine.analyze({
      astResults: [billingAst, clientAst],
      dependencyGraph: depGraph,
      symbolTables: [billingSymbols, clientSymbols],
    });

    const chargeExportSymbol = billingSymbols.symbols.find((s) => s.kind === "export" && s.name === "charge");
    expect(chargeExportSymbol).toBeDefined();

    const shadowedCall = analysis.calls.find((c) => c.callerName === "run" && c.calleeName === "charge");
    expect(shadowedCall).toBeDefined();
    // Catch parameter shadows import: must NOT resolve to import!
    expect(shadowedCall?.targetSymbolId).toBeUndefined();
    expect(shadowedCall?.resolutionState).toBe("UNRESOLVED");

    const normalCall = analysis.calls.find((c) => c.callerName === "normal" && c.calleeName === "charge");
    expect(normalCall).toBeDefined();
    expect(normalCall?.targetSymbolId).toBe(chargeExportSymbol?.id);
    expect(normalCall?.resolutionState).toBe("RESOLVED");
  });

  it("honors for-of loop variable shadowing of an import", async () => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const depBuilder = new DeterministicDependencyGraphBuilder();
    const callGraphBuilder = new DeterministicCallGraphBuilder();
    const engine = new DeterministicSemanticAnalysisEngine(callGraphBuilder);

    const billingSource = `export function charge() { return "charged"; }`;
    const clientSource = `
      import { charge } from "./billing";

      function run(handlers) {
        for (const charge of handlers) {
          charge();
        }
      }

      function normal() {
        charge();
      }
    `;

    const billingFile = { id: "f1", path: "src/billing.js", language: "javascript", size: billingSource.length };
    const clientFile = { id: "f2", path: "src/client.js", language: "javascript", size: clientSource.length };

    const billingAst = (await parser.parse({ file: billingFile, source: billingSource })).result!;
    const clientAst = (await parser.parse({ file: clientFile, source: clientSource })).result!;

    const billingSymbols = extractor.extract(billingAst);
    const clientSymbols = extractor.extract(clientAst);

    const depGraph = depBuilder.build([billingSymbols, clientSymbols], [billingFile, clientFile]);
    const analysis = engine.analyze({
      astResults: [billingAst, clientAst],
      dependencyGraph: depGraph,
      symbolTables: [billingSymbols, clientSymbols],
    });

    const chargeExportSymbol = billingSymbols.symbols.find((s) => s.kind === "export" && s.name === "charge");
    expect(chargeExportSymbol).toBeDefined();

    const shadowedCall = analysis.calls.find((c) => c.callerName === "run" && c.calleeName === "charge");
    expect(shadowedCall).toBeDefined();
    // Loop variable shadows import: must NOT resolve to import!
    expect(shadowedCall?.targetSymbolId).toBeUndefined();
    expect(shadowedCall?.resolutionState).toBe("UNRESOLVED");

    const normalCall = analysis.calls.find((c) => c.callerName === "normal" && c.calleeName === "charge");
    expect(normalCall).toBeDefined();
    expect(normalCall?.targetSymbolId).toBe(chargeExportSymbol?.id);
    expect(normalCall?.resolutionState).toBe("RESOLVED");
  });
});
