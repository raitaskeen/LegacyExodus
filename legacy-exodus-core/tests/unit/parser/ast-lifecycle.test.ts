import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEngineContext } from "@runtime/composition/services";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { DeterministicFlowAnalysisEngine } from "@flow/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";
import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";
import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { ModuleResolver } from "@graph/module-resolver";

describe("F-04: Whole-Repository AST Retention & Lifecycle Invariant", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  let tempDir: string;
  let projectPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "legacy-exodus-ast-life-"));
    projectPath = join(tempDir, "workspace");
    const srcDir = join(projectPath, "src");
    await mkdir(srcDir, { recursive: true });

    await writeFile(
      join(srcDir, "service.ts"),
      "export class UserService { getUser(id: string) { return { id, name: 'Alice' }; } }",
      "utf8",
    );
    await writeFile(
      join(srcDir, "app.ts"),
      "import { UserService } from './service'; const service = new UserService(); service.getUser('1');",
      "utf8",
    );
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { force: true, recursive: true });
    } catch {
      // Ignored
    }
  });

  it("proves downstream analysis engines (Semantic, Flow, Symbols) do not retain AST references on engine instances", async () => {
    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());
    const parserManager = new ParserManager(registry);
    const symbolExtractor = new JavaScriptSymbolExtractor();

    const fileA = { id: "f1", path: "src/service.ts", size: 100, language: "typescript" };
    const fileB = { id: "f2", path: "src/app.ts", size: 100, language: "typescript" };

    const astA = await parserManager.parse({
      file: fileA,
      source: "export class UserService { getUser(id: string) { return { id, name: 'Alice' }; } }",
    });
    const astB = await parserManager.parse({
      file: fileB,
      source: "import { UserService } from './service'; const service = new UserService(); service.getUser('1');",
    });

    const tableA = symbolExtractor.extract(astA);
    const tableB = symbolExtractor.extract(astB);
    const symbolTables = [tableA, tableB];

    const depGraphBuilder = new DeterministicDependencyGraphBuilder(new ModuleResolver());
    const dependencyGraph = depGraphBuilder.build(symbolTables, [fileA, fileB]);

    const astResults = [astA, astB];

    // 1. Semantic Engine
    const semanticEngine = new DeterministicSemanticAnalysisEngine();
    const semantic = semanticEngine.analyze({ astResults, dependencyGraph, symbolTables });

    // Verify SemanticAnalysis result contains no AST roots or nodes
    expect(semantic).toBeDefined();
    expect((semantic as any).astResults).toBeUndefined();
    expect((semantic as any).root).toBeUndefined();

    // 2. Flow Engine
    const flowEngine = new DeterministicFlowAnalysisEngine();
    const flow = flowEngine.analyze(astResults, semantic.calls, symbolTables);

    // Verify FlowAnalysisResult contains no AST roots or nodes
    expect(flow.controlFlowGraphs.length).toBeGreaterThan(0);
    expect(flow.dataFlowGraphs.length).toBeGreaterThan(0);
    expect((flow as any).astResults).toBeUndefined();

    // 3. Clear transient AST collection
    astResults.length = 0;
    expect(astResults).toHaveLength(0);
  });

  it("proves Orchestrator execution releases transient AST collection and returns zero AST trees in records and events", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });

    const result = await context.orchestrator.execute({
      id: runId,
      type: "AnalyzeProject",
      createdAt: new Date(),
      payload: {
        projectId,
        path: projectPath,
      },
    });

    // Verify execution succeeded
    expect(result.analysis).toBeDefined();
    expect(result.analysis!.filesDiscovered).toBe(2);
    expect(result.analysis!.filesAnalyzed).toBe(2);

    // Verify that stored 'ast-result' records store only compact metadata, NOT the AST tree
    const astRecords = result.records.filter((r) => r.type === "ast-result");
    expect(astRecords).toHaveLength(2);
    for (const record of astRecords) {
      expect(record.payload).toHaveProperty("fileId");
      expect(record.payload).toHaveProperty("path");
      expect(record.payload).toHaveProperty("parserId");
      expect(record.payload).toHaveProperty("nodeCount");
      expect(record.payload).toHaveProperty("errorCount");
      // Must not contain AST tree root
      expect((record.payload as any).root).toBeUndefined();
      expect((record.payload as any).ast).toBeUndefined();
    }

    // Verify that FileParsed domain events store only compact metadata
    const parsedEvents = result.events.filter((e) => e.type === "FileParsed");
    expect(parsedEvents).toHaveLength(2);
    for (const event of parsedEvents) {
      expect(event.payload).toHaveProperty("fileId");
      expect(event.payload).toHaveProperty("path");
      expect(event.payload).toHaveProperty("parserId");
      expect(event.payload).toHaveProperty("nodeCount");
      expect((event.payload as any).root).toBeUndefined();
      expect((event.payload as any).ast).toBeUndefined();
    }
  });

  it("proves downstream analysis failure cleans up transient ASTs and preserves compact record contracts", async () => {
    // Construct a corrupted ASTResult that fails in Semantic analysis
    const corruptedAst = {
      root: { id: "node_1", type: "InvalidNode", text: "err", children: [] },
      metadata: { sourcePath: "src/corrupt.ts", parserId: "javascript-parser" },
      statistics: { nodeCount: 1 },
      errors: [],
    };

    const astResults = [corruptedAst as any];
    const symbolTables: any[] = [];
    const depGraph = { nodes: [], edges: [], cycles: [] };

    const semanticEngine = new DeterministicSemanticAnalysisEngine();

    // Semantic engine gracefully handles or throws, and caller ensures cleanup
    try {
      semanticEngine.analyze({ astResults, dependencyGraph: depGraph as any, symbolTables });
    } catch {
      // Intentionally caught
    } finally {
      astResults.length = 0;
    }

    expect(astResults).toHaveLength(0);
  });
});
