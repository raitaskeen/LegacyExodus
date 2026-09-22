import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus } from "@core/events/event-bus";
import { InMemoryEventStore } from "@core/events/event-store";
import { Orchestrator } from "@core/orchestration/orchestrator";
import { DiscoveryEngine } from "@discovery/index";
import { DeterministicDataFlowGraphBuilder } from "@flow/data-flow-builder";
import { JavaScriptParser, ParserManager, ParserRegistry, type ASTResult } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";
import { MemoryStorageProvider, StorageManager } from "@storage/index";

describe("F-09: Bounded Per-File AST Lifecycle & Whole-Repository Retention Invariant", () => {
  let tempDir: string;
  let projectPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "le-bounded-ast-"));
    projectPath = join(tempDir, "workspace");
    const srcDir = join(projectPath, "src");
    await mkdir(srcDir, { recursive: true });

    // Create 12 inter-dependent source files
    for (let i = 0; i < 12; i++) {
      const prevImport = i > 0 ? `import { fn_${i - 1} } from "./module_${i - 1}";\n` : "";
      const prevCall = i > 0 ? `  fn_${i - 1}();\n` : "";
      await writeFile(
        join(srcDir, `module_${i}.ts`),
        `${prevImport}export function fn_${i}() {\n  const val = ${i};\n${prevCall}  return val;\n}\n`,
        "utf8",
      );
    }
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { force: true, recursive: true });
    } catch {}
  });

  it("proves repository analysis does not retain all ASTs simultaneously (bounded in-flight AST invariant)", async () => {
    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());

    const trackedASTRefs: { path: string; resultRef: WeakRef<ASTResult>; rootRef: WeakRef<any>; deepRef: WeakRef<any> }[] = [];
    let peakConcurrentlyLiveASTs = 0;
    let peakConcurrentlyLiveRoots = 0;
    let peakConcurrentlyLiveDeepNodes = 0;

    function findDeepNode(node: any, depth = 0): any {
      let deepest = node;
      for (const child of node.children ?? []) {
        const found = findDeepNode(child, depth + 1);
        if (found) deepest = found;
      }
      return deepest;
    }

    class BoundedTrackingParserManager extends ParserManager {
      public override async parse(request: any): Promise<ASTResult> {
        // Trigger GC if available to clean up unreferenced ASTs
        if (typeof Bun !== "undefined" && Bun.gc) {
          Bun.gc(true);
        } else if (global.gc) {
          global.gc();
        }

        // Count how many previously emitted ASTs and nodes remain reachable in memory
        const currentLiveResults = trackedASTRefs.filter((item) => item.resultRef.deref() !== undefined).length;
        const currentLiveRoots = trackedASTRefs.filter((item) => item.rootRef.deref() !== undefined).length;
        const currentLiveDeepNodes = trackedASTRefs.filter((item) => item.deepRef.deref() !== undefined).length;

        if (currentLiveResults > peakConcurrentlyLiveASTs) peakConcurrentlyLiveASTs = currentLiveResults;
        if (currentLiveRoots > peakConcurrentlyLiveRoots) peakConcurrentlyLiveRoots = currentLiveRoots;
        if (currentLiveDeepNodes > peakConcurrentlyLiveDeepNodes) peakConcurrentlyLiveDeepNodes = currentLiveDeepNodes;

        const result = await super.parse(request);
        const deep = findDeepNode(result.root);
        trackedASTRefs.push({
          path: request.file.path,
          resultRef: new WeakRef(result),
          rootRef: new WeakRef(result.root),
          deepRef: new WeakRef(deep),
        });
        return result;
      }
    }

    const trackingParserManager = new BoundedTrackingParserManager(registry);
    const eventStore = new InMemoryEventStore();
    const eventBus = new EventBus();
    const storage = new StorageManager(new MemoryStorageProvider());

    const orchestrator = new Orchestrator(
      eventStore,
      eventBus,
      storage,
      new DiscoveryEngine(),
      undefined,
      trackingParserManager,
      new JavaScriptSymbolExtractor(),
    );

    const result = await orchestrator.execute({
      id: randomUUID(),
      type: "AnalyzeProject",
      createdAt: new Date(),
      payload: {
        projectId: randomUUID(),
        path: projectPath,
      },
    });

    expect(result.analysis).toBeDefined();
    expect(result.analysis!.filesAnalyzed).toBe(12);

    // INVARIANT A: During whole-repository analysis of 12 files, the peak concurrently
    // retained prior ASTs must be bounded (<= 2 in concurrent GC sweep conditions, << 12 total files),
    // proving that completed ASTs are released per-file rather than accumulated in an unbounded O(N) array throughout execution.
    expect(peakConcurrentlyLiveASTs).toBeLessThanOrEqual(2);
    expect(peakConcurrentlyLiveRoots).toBeLessThanOrEqual(2);
    expect(peakConcurrentlyLiveDeepNodes).toBeLessThanOrEqual(2);

    // INVARIANT B: After analysis completes, all ASTs are eligible for GC
    if (typeof Bun !== "undefined" && Bun.gc) {
      Bun.gc(true);
    } else if (global.gc) {
      global.gc();
    }
    const finalLiveASTs = trackedASTRefs.filter((item) => item.resultRef.deref() !== undefined).length;
    const finalLiveRoots = trackedASTRefs.filter((item) => item.rootRef.deref() !== undefined).length;
    const finalLiveDeepNodes = trackedASTRefs.filter((item) => item.deepRef.deref() !== undefined).length;
    expect(finalLiveASTs).toBe(0);
    expect(finalLiveRoots).toBe(0);
    expect(finalLiveDeepNodes).toBe(0);
  });

  it("proves DataFlowBuilder buildContext result does not retain ASTNode references in returned state", async () => {
    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());
    const parserManager = new ParserManager(registry);
    const file = { id: "f1", path: "test.ts", size: 100, language: "typescript" as const, fileKind: "source" as const };
    const ast = await parserManager.parse({
      file,
      source: "export function testFn(a: number) { return a + 1; }",
    });

    const dfgBuilder = new DeterministicDataFlowGraphBuilder();
    const context = dfgBuilder.buildContext(ast, undefined, []);

    // The compact connection state must not own function maps capable of retaining AST nodes.
    expect(Object.keys(context.state).sort()).toEqual(["sinks", "taintPaths", "transfers"]);
    expect("functions" in context.state).toBe(false);
    expect("resolvableFunctions" in context.state).toBe(false);
    expect("functionsBySymbolId" in context.state).toBe(false);
    expect(Reflect.ownKeys(context.state).filter((key) => typeof key === "symbol")).toEqual([]);
  });
});
