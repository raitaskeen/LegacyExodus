/**
 * Milestone P1.7A — Failure-First Test Suite
 *
 * Dynamic and Intermediate Call Resolution
 *
 * Covers:
 * 1. Direct local function call
 * 2. Known imported function call
 * 3. Known constructor call (new Route(), new Layer())
 * 4. Statically provable receiver method call (server.listen via .apply, this.defaultConfiguration)
 * 5. Unique cross-file receiver call
 * 6. Ambiguous same-name receiver negative case (must remain UNRESOLVED)
 * 7. Computed-property negative case (must remain UNRESOLVED)
 * 8. Runtime-dynamic receiver negative case (must remain UNRESOLVED)
 * 9. Recursion / cyclic target safety
 * 10. Deterministic resolution output
 */

import { describe, expect, it } from "bun:test";
import { JavaScriptParser, type ParseRequest } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";
import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { ModuleResolver } from "@graph/module-resolver";
import { DeterministicCallGraphBuilder } from "@semantic/call-graph-builder";
import type { ASTResult } from "@parser/index";
import type { SymbolTable } from "@symbols/index";

describe("Milestone P1.7A — Dynamic & Intermediate Call Resolution", () => {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const graphBuilder = new DeterministicDependencyGraphBuilder(new ModuleResolver());
  const callGraphBuilder = new DeterministicCallGraphBuilder();

  function createRequest(source: string, path: string): ParseRequest {
    return {
      file: {
        id: path,
        path,
        language: "javascript",
        size: source.length,
      },
      source,
    };
  }

  async function buildCallGraph(files: { path: string; code: string }[]) {
    const astResults: ASTResult[] = [];
    const symbolTables: SymbolTable[] = [];

    for (const file of files) {
      const response = await parser.parse(createRequest(file.code, file.path));
      const ast = response.result!;
      astResults.push(ast);
      const symbols = extractor.extract(ast);
      symbolTables.push(symbols);
    }

    const knownPaths = new Set(files.map((f) => f.path));
    const depGraph = graphBuilder.build(symbolTables, knownPaths);
    return callGraphBuilder.build(astResults, symbolTables, depGraph);
  }

  // ─── 1. Direct Local Function Call ─────────────────────────────────────────
  it("Scenario 1: resolves direct local function call", async () => {
    const files = [
      {
        path: "src/app.js",
        code: `
          function helper() { return 1; }
          function main() { return helper(); }
        `,
      },
    ];
    const { calls } = await buildCallGraph(files);
    const helperCall = calls.find((c) => c.calleeName === "helper");
    expect(helperCall).toBeDefined();
    expect(helperCall?.resolutionState).toBe("RESOLVED");
  });

  // ─── 2. Known Imported Function Call ───────────────────────────────────────
  it("Scenario 2: resolves imported function calls across files", async () => {
    const files = [
      {
        path: "src/utils.js",
        code: `
          function format(x) { return String(x); }
          module.exports = { format };
        `,
      },
      {
        path: "src/index.js",
        code: `
          const { format } = require('./utils');
          function run() { format(42); }
        `,
      },
    ];
    const { calls } = await buildCallGraph(files);
    const formatCall = calls.find((c) => c.calleeName === "format" && c.sourceFilePath === "src/index.js");
    expect(formatCall).toBeDefined();
    expect(formatCall?.resolutionState).toBe("RESOLVED");
  });

  // ─── 3. Known Constructor Call (NewExpression) ────────────────────────────
  it("Scenario 3: extracts and resolves constructor new Route() / new Layer() calls", async () => {
    const files = [
      {
        path: "src/route.js",
        code: `
          function Route(path) { this.path = path; }
          module.exports = Route;
        `,
      },
      {
        path: "src/router.js",
        code: `
          const Route = require('./route');
          function createRoute(path) {
            return new Route(path);
          }
        `,
      },
    ];
    const { calls } = await buildCallGraph(files);
    const newRouteCall = calls.find((c) => c.calleeName === "Route" && c.sourceFilePath === "src/router.js");
    expect(newRouteCall).toBeDefined();
    expect(newRouteCall?.resolutionState).toBe("RESOLVED");
  });

  // ─── 4. Unwrapping .apply / .call on Server.listen ─────────────────────────
  it("Scenario 4: unwraps .apply / .call invocations to identify underlying callee (server.listen)", async () => {
    const files = [
      {
        path: "src/application.js",
        code: `
          var app = {};
          app.listen = function listen() {
            var server = http.createServer(this);
            return server.listen.apply(server, arguments);
          };
        `,
      },
    ];
    const { calls } = await buildCallGraph(files);
    const listenCall = calls.find((c) => c.calleeName === "server.listen");
    expect(listenCall).toBeDefined();
  });

  // ─── 5. Statically Provable this.method() Resolution ──────────────────────
  it("Scenario 5: resolves this.defaultConfiguration against enclosing prototype methods", async () => {
    const files = [
      {
        path: "src/application.js",
        code: `
          var app = {};
          app.defaultConfiguration = function() { return {}; };
          app.init = function() {
            this.defaultConfiguration();
          };
        `,
      },
    ];
    const { calls } = await buildCallGraph(files);
    const configCall = calls.find((c) => c.calleeName === "this.defaultConfiguration");
    expect(configCall).toBeDefined();
    expect(configCall?.resolutionState).toBe("RESOLVED");
  });

  // ─── 6. Ambiguous Same-Name Receiver Negative Case ────────────────────────
  it("Scenario 6 (FAILURE-FIRST NEGATIVE): leaves ambiguous calls UNRESOLVED when multiple targets match", async () => {
    const files = [
      {
        path: "src/ambiguous.js",
        code: `
          function doSomething() {
            var a = getUnknown();
            a.render();
          }
        `,
      },
    ];
    const { calls } = await buildCallGraph(files);
    const renderCall = calls.find((c) => c.calleeName === "a.render");
    expect(renderCall).toBeDefined();
    expect(renderCall?.resolutionState).toBe("UNRESOLVED");
  });

  // ─── 7. Computed Property Negative Case ───────────────────────────────────
  it("Scenario 7 (FAILURE-FIRST NEGATIVE): does NOT hallucinate calls on dynamic computed member access", async () => {
    const files = [
      {
        path: "src/computed.js",
        code: `
          function dispatch(obj, method) {
            obj[method]();
          }
        `,
      },
    ];
    const { calls } = await buildCallGraph(files);
    const phantomCalls = calls.filter((c) => c.calleeName?.includes("method"));
    expect(phantomCalls.length).toBe(0);
  });

  // ─── 8. Runtime-Dynamic Receiver Negative Case ────────────────────────────
  it("Scenario 8 (FAILURE-FIRST NEGATIVE): keeps runtime-dynamic calls UNRESOLVED", async () => {
    const files = [
      {
        path: "src/dynamic.js",
        code: `
          function exec(handler) {
            handler.process();
          }
        `,
      },
    ];
    const { calls } = await buildCallGraph(files);
    const procCall = calls.find((c) => c.calleeName === "handler.process");
    expect(procCall?.resolutionState).toBe("UNRESOLVED");
  });

  // ─── 9. Cyclic / Recursive Target Safety ──────────────────────────────────
  it("Scenario 9: safely handles recursive and cyclic function calls without stack overflow", async () => {
    const files = [
      {
        path: "src/cycle.js",
        code: `
          function ping() { pong(); }
          function pong() { ping(); }
        `,
      },
    ];
    const { calls } = await buildCallGraph(files);
    expect(calls.length).toBe(2);
    expect(calls[0]?.resolutionState).toBe("RESOLVED");
    expect(calls[1]?.resolutionState).toBe("RESOLVED");
  });

  // ─── 10. Deterministic Resolution Output ──────────────────────────────────
  it("Scenario 10: produces deterministic identical call graph IDs across repeated runs", async () => {
    const files = [
      {
        path: "src/app.js",
        code: `
          function a() { return b(); }
          function b() { return 1; }
        `,
      },
    ];
    const run1 = await buildCallGraph(files);
    const run2 = await buildCallGraph(files);
    expect(run1.calls.map((c) => c.id)).toEqual(run2.calls.map((c) => c.id));
  });
});
