import { describe, expect, test } from "bun:test";

import { DeterministicFlowAnalysisEngine } from "@flow/flow-analysis-engine";
import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { JavaScriptParser, type ASTResult } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/semantic-engine";
import { JavaScriptSymbolExtractor, type SymbolTable } from "@symbols/index";

interface Fixture {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly name: string;
  readonly kind?: "import";
  readonly moduleSpecifier?: string;
  readonly sourceSymbolName?: string;
  readonly defaultExport?: boolean;
  readonly localName?: string;
}

const fixtures: readonly Fixture[] = [
  { id: "T01", title: "local function string is not a module source", source: 'export function f() { return "x"; }', name: "f", localName: "f" },
  { id: "T02", title: "local path-like string is not a module source", source: 'export function f() { return "./fake-path.js"; }', name: "f", localName: "f" },
  { id: "T03", title: "local const string", source: 'export const f = "x";', name: "f", localName: "f" },
  { id: "T04", title: "local arrow string", source: 'export const f = () => "x";', name: "f", localName: "f" },
  { id: "T05", title: "local class method string", source: 'export class F { method() { return "x"; } }', name: "F", localName: "F" },
  { id: "T06", title: "local export specifier", source: 'function f() { return "x"; } export { f };', name: "f", sourceSymbolName: "f", localName: "f" },
  { id: "T07", title: "local default function", source: 'export default function f() { return "x"; }', name: "default", defaultExport: true, sourceSymbolName: "f", localName: "f" },
  { id: "T08", title: "local default literal", source: 'export default "x";', name: "default", defaultExport: true },
  { id: "T09", title: "named forwarding provenance", source: 'export { f } from "./c.js";', name: "f", moduleSpecifier: "./c.js", sourceSymbolName: "f" },
  { id: "T10", title: "aliased forwarding provenance", source: 'export { f as publicF } from "./c.js";', name: "publicF", moduleSpecifier: "./c.js", sourceSymbolName: "f" },
  { id: "T11", title: "default forwarding provenance", source: 'export { default as f } from "./c.js";', name: "f", moduleSpecifier: "./c.js", sourceSymbolName: "default" },
  { id: "T12", title: "wildcard forwarding provenance", source: 'export * from "./c.js";', name: "*", moduleSpecifier: "./c.js" },
  { id: "T13", title: "namespace forwarding provenance", source: 'export * as ns from "./c.js";', name: "ns", moduleSpecifier: "./c.js", sourceSymbolName: "*" },
  { id: "T14", title: "named import preservation", source: 'import { f } from "./c.js";', name: "f", kind: "import", moduleSpecifier: "./c.js", sourceSymbolName: "f" },
  { id: "T15", title: "default import preservation", source: 'import f from "./c.js";', name: "f", kind: "import", moduleSpecifier: "./c.js", defaultExport: true },
  { id: "T16", title: "namespace import preservation", source: 'import * as ns from "./c.js";', name: "ns", kind: "import", moduleSpecifier: "./c.js", sourceSymbolName: "*" },
  { id: "T17", title: "side-effect import preservation", source: 'import "./c.js";', name: "./c.js", kind: "import", moduleSpecifier: "./c.js" },
];

async function parse(source: string, path = "src/fixture.js"): Promise<ASTResult> {
  const result = await new JavaScriptParser().parse({
    file: { id: `file:${path}`, path, language: "javascript", size: source.length },
    source,
  });
  expect(result.result.errors).toEqual([]);
  return result.result;
}

function checkSymbol(table: SymbolTable, fixture: Fixture): void {
  const symbols = table.symbols.filter((symbol) => symbol.kind === (fixture.kind ?? "export"));
  expect(symbols).toHaveLength(1);
  const symbol = symbols[0];
  expect(symbol?.name).toBe(fixture.name);
  expect(symbol?.defaultExport).toBe(fixture.defaultExport ?? false);
  expect(symbol?.sourceSymbolName).toBe(fixture.sourceSymbolName);
  if (fixture.localName !== undefined) {
    expect(table.symbols.some((entry) =>
      entry.kind !== "export" && entry.name === fixture.localName && entry.exported)).toBe(true);
  }
  expect(symbol?.moduleSpecifier).toBe(fixture.moduleSpecifier);
}

async function analyzeFlow(serviceSource: string) {
  const consumerSource = 'import { runCmd } from "./service.js"; const payload = req.body.command; runCmd(payload);';
  const serviceAst = await parse(serviceSource, "src/service.js");
  const consumerAst = await parse(consumerSource, "src/consumer.js");
  const astResults = [serviceAst, consumerAst];
  const extractor = new JavaScriptSymbolExtractor();
  const symbolTables = astResults.map((ast) => extractor.extract(ast));
  const files = [
    { id: "file:src/service.js", path: "src/service.js", language: "javascript", size: serviceSource.length },
    { id: "file:src/consumer.js", path: "src/consumer.js", language: "javascript", size: consumerSource.length },
  ];
  const graph = new DeterministicDependencyGraphBuilder().build(symbolTables, files);
  const semantic = new DeterministicSemanticAnalysisEngine().analyze({ astResults, symbolTables, dependencyGraph: graph });
  const flow = new DeterministicFlowAnalysisEngine().analyze(astResults, semantic.calls, symbolTables);
  const serviceTable = symbolTables.find((table) => table.filePath === "src/service.js");
  const exported = serviceTable?.symbols.find((symbol) => symbol.kind === "export" && symbol.name === "runCmd");
  const service = flow.dataFlowGraphs.find((entry) => entry.filePath === "src/service.js");
  const consumer = flow.dataFlowGraphs.find((entry) => entry.filePath === "src/consumer.js");
  if (exported === undefined || service === undefined || consumer === undefined) throw new Error("Missing flow fixture artifacts");
  return { exported, service, consumer, graph, semantic };
}

function checkFlow(result: Awaited<ReturnType<typeof analyzeFlow>>) {
  expect(result.graph.edges).toHaveLength(1);
  expect(result.graph.edges[0]?.targetExportSymbolId).toBe(result.exported.id);
  const calls = result.semantic.calls.filter((call) => call.calleeName === "runCmd");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.resolutionState).toBe("RESOLVED");
  expect(calls[0]?.targetSymbolId).toBe(result.exported.id);
  const payload = result.consumer.definitions.find((definition) => definition.name === "payload");
  const parameter = result.service.definitions.find((definition) => definition.kind === "parameter" && definition.name === "cmd");
  expect(payload).toBeDefined();
  expect(parameter).toBeDefined();
  expect(result.consumer.callBindings).toHaveLength(1);
  expect(result.consumer.callBindings[0]).toMatchObject({ targetSymbolId: result.exported.id, argumentDefinitionIds: [payload?.id] });
  const transfers = result.consumer.interproceduralFlows.filter((transfer) => transfer.kind === "argument-to-parameter");
  expect(transfers).toHaveLength(1);
  expect(transfers[0]).toMatchObject({ sourceDefinitionId: payload?.id, targetDefinitionId: parameter?.id });
  expect(result.service.taintFlows).toHaveLength(1);
  expect(result.service.taintFlows[0]?.state).toBe("CONFIRMED");
  expect(result.service.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  expect(result.service.taintFlows[0]?.path).toContain(payload?.id);
  expect(result.service.taintFlows[0]?.path).toContain(parameter?.id);
  expect(result.exported.moduleSpecifier).toBeUndefined();
  return {
    edgeCount: result.graph.edges.length,
    callState: calls[0]?.resolutionState,
    transferKinds: transfers.map((transfer) => transfer.kind),
    taint: result.service.taintFlows.map((taint) => ({ state: taint.state, sink: taint.path.at(-1) })),
  };
}

describe("F04-P1 module specifier provenance", () => {
  for (const fixture of fixtures) {
    test(`${fixture.id} ${fixture.title}`, async () => {
      checkSymbol(new JavaScriptSymbolExtractor().extract(await parse(fixture.source)), fixture);
    });
  }

  test("T18 local declaration export marking survives strings and nested declarations", async () => {
    for (const source of [
      'export function f() { return "x"; }',
      'export function f(value = "default") { return value; }',
      'export function f() { function nested() { return "lodash"; } return nested(); }',
    ]) {
      const table = new JavaScriptSymbolExtractor().extract(await parse(source));
      expect(table.symbols.filter((symbol) => symbol.kind === "function" && symbol.name === "f"))
        .toMatchObject([{ exported: true }]);
    }
  });

  test("T19 five fresh and reused extractor executions produce byte-identical symbol tables", async () => {
    const asts = await Promise.all(fixtures.map((fixture) => parse(fixture.source)));
    const expected = asts.map((ast) => JSON.stringify(new JavaScriptSymbolExtractor().extract(ast)));
    const reused = new JavaScriptSymbolExtractor();
    for (let run = 0; run < 5; run += 1) {
      expect(asts.map((ast) => JSON.stringify(new JavaScriptSymbolExtractor().extract(ast)))).toEqual(expected);
      expect(asts.map((ast) => JSON.stringify(reused.extract(ast)))).toEqual(expected);
    }
  });

  test("T20 extraction does not mutate local or forwarding ASTs", async () => {
    for (const fixture of fixtures) {
      const ast = await parse(fixture.source);
      const before = JSON.stringify(ast);
      new JavaScriptSymbolExtractor().extract(ast);
      expect(JSON.stringify(ast)).toBe(before);
    }
  });

  test("flow metamorphic invariant: an irrelevant string cannot erase export linkage or taint", async () => {
    const clean = await analyzeFlow('export function runCmd(cmd) { child_process.exec(cmd); }');
    const polluted = await analyzeFlow('export function runCmd(cmd) { const msg = "executing"; child_process.exec(cmd); }');
    const cleanLinkage = checkFlow(clean);
    expect(checkFlow(polluted)).toEqual(cleanLinkage);
  });
});

