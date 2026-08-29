import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JavaScriptParser, type ParseRequest } from "@parser/index";
import {
  JavaScriptSymbolExtractor,
  SymbolExtractionError,
  UnsupportedSymbolLanguageError,
  validateSymbolTable,
} from "@symbols/index";
import { LegacyExodusError } from "@shared/errors";
import { InMemoryEventStore } from "@core/events/event-store";
import { EventBus } from "@core/events/event-bus";
import { StorageManager } from "@storage/storage-manager";
import { MemoryStorageProvider } from "@storage/adapters/memory-storage";
import { DiscoveryEngine } from "@discovery/discovery-engine";
import { Orchestrator } from "@core/orchestration/orchestrator";

function createParseRequest(source: string, language = "javascript", path = "service.js"): ParseRequest {
  return {
    file: {
      id: "f-symbol-1",
      path,
      language,
      size: source.length,
    },
    source,
  };
}

describe("F-02: Symbol Extraction Error Classification & Accounting Invariant", () => {
  const projectId = "22222222-2222-4222-8222-222222222222";
  const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  const tempDirs: string[] = [];

  async function createWorkspace(): Promise<string> {
    const tempDir = await mkdtemp(join(tmpdir(), "legacy-exodus-sym-err-"));
    tempDirs.push(tempDir);
    return tempDir;
  }

  afterEach(async () => {
    for (const dir of tempDirs) {
      try {
        await rm(dir, { force: true, recursive: true });
      } catch {
        // Ignored
      }
    }
    tempDirs.length = 0;
  });

  describe("A. Direct Symbol Extractor Error Semantics", () => {
    it("instantiates SymbolExtractionError with default code and empty metadata", () => {
      const error = new SymbolExtractionError("Extraction failed unexpectedly");

      expect(error).toBeInstanceOf(LegacyExodusError);
      expect(error).toBeInstanceOf(SymbolExtractionError);
      expect(error.name).toBe("SymbolExtractionError");
      expect(error.code).toBe("SYMBOL_EXTRACTION_FAILED");
      expect(error.message).toBe("Extraction failed unexpectedly");
      expect(error.metadata).toEqual({});
    });

    it("instantiates SymbolExtractionError with custom code and metadata", () => {
      const error = new SymbolExtractionError(
        "Custom symbol failure",
        "SYMBOL_CUSTOM_CODE",
        { path: "a.js" },
      );

      expect(error).toBeInstanceOf(LegacyExodusError);
      expect(error).toBeInstanceOf(SymbolExtractionError);
      expect(error.name).toBe("SymbolExtractionError");
      expect(error.code).toBe("SYMBOL_CUSTOM_CODE");
      expect(error.message).toBe("Custom symbol failure");
      expect(error.metadata).toEqual({ path: "a.js" });
    });

    it("successfully extracts symbols from valid JavaScript and TypeScript ASTs", async () => {
      const parser = new JavaScriptParser();
      const extractor = new JavaScriptSymbolExtractor();

      const jsSource = "export function add(a, b) { return a + b; }";
      const jsAst = (await parser.parse(createParseRequest(jsSource, "javascript", "add.js"))).result;
      const jsTable = extractor.extract(jsAst);

      expect(jsTable.symbols).toHaveLength(2);
      expect(jsTable.symbols.some((s) => s.name === "add" && s.kind === "function")).toBe(true);
      expect(jsTable.symbols.some((s) => s.name === "add" && s.kind === "export")).toBe(true);
      expect(jsTable.summary.functions).toBe(1);
      expect(jsTable.summary.exports).toBe(1);
    });

    it("throws UnsupportedSymbolLanguageError with SYMBOL_LANGUAGE_UNSUPPORTED for unsupported languages", async () => {
      const extractor = new JavaScriptSymbolExtractor();

      const syntheticPythonAst = {
        root: {
          id: "node-1",
          type: "Program",
          attributes: {},
          children: [],
        },
        metadata: {
          sourcePath: "script.py",
          parserId: "python-parser",
          language: "python",
        },
        statistics: { durationMs: 1, nodeCount: 1 },
        warnings: [],
        errors: [],
      };

      try {
        extractor.extract(syntheticPythonAst as any);
        expect(true).toBe(false); // Should not reach
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(UnsupportedSymbolLanguageError);
        expect((error as UnsupportedSymbolLanguageError).code).toBe("SYMBOL_LANGUAGE_UNSUPPORTED");
        expect((error as UnsupportedSymbolLanguageError).metadata).toEqual({ language: "python" });
      }
    });

    it("throws LegacyExodusError with AST_RESULT_INVALID for malformed AST input", () => {
      const extractor = new JavaScriptSymbolExtractor();

      const invalidAst = {
        // Missing required root and metadata fields
        somethingElse: true,
      };

      try {
        extractor.extract(invalidAst as any);
        expect(true).toBe(false); // Should not reach
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(LegacyExodusError);
        expect((error as LegacyExodusError).code).toBe("AST_RESULT_INVALID");
      }
    });

    it("throws LegacyExodusError with SYMBOL_TABLE_INVALID when symbol table schema validation fails", () => {
      const invalidTable = {
        filePath: "invalid.js",
        language: "javascript",
        symbols: [
          {
            // Missing required symbol fields like kind, name, id
            id: "",
          },
        ],
        summary: {
          classes: 0,
        },
      };

      try {
        validateSymbolTable(invalidTable);
        expect(true).toBe(false); // Should not reach
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(LegacyExodusError);
        expect((error as LegacyExodusError).code).toBe("SYMBOL_TABLE_INVALID");
      }
    });

    it("extracts 0 symbols cleanly from empty valid source file without throwing or failing", async () => {
      const parser = new JavaScriptParser();
      const extractor = new JavaScriptSymbolExtractor();

      const emptyAst = (await parser.parse(createParseRequest("", "javascript", "empty.js"))).result;
      const table = extractor.extract(emptyAst);

      expect(table.symbols).toHaveLength(0);
      expect(table.summary).toEqual({
        classes: 0,
        exports: 0,
        functions: 0,
        imports: 0,
        methods: 0,
        variables: 0,
      });
      expect(table.filePath).toBe("empty.js");
      expect(table.language).toBe("javascript");
    });
  });

  describe("B. Orchestrator Error Classification, Event Emission, Storage & Accounting", () => {
    it("isolates symbol extraction failure, emits SymbolsExtractionFailure event, and reconciles file accounting", async () => {
      const projectPath = await createWorkspace();
      await writeFile(join(projectPath, "good.js"), "export const good = 42;", "utf8");
      await writeFile(join(projectPath, "bad.js"), "export const bad = 100;", "utf8");

      class SyntheticFaultyExtractor extends JavaScriptSymbolExtractor {
        public override extract(ast: Parameters<JavaScriptSymbolExtractor["extract"]>[0]): ReturnType<JavaScriptSymbolExtractor["extract"]> {
          if (ast.metadata.sourcePath === "bad.js") {
            throw new LegacyExodusError({
              code: "SYMBOL_EXTRACTION_SYNTHETIC_FAULT",
              message: "Simulated extraction failure on bad.js",
            });
          }
          return super.extract(ast);
        }
      }

      const eventStore = new InMemoryEventStore();
      const eventBus = new EventBus();
      const storageManager = new StorageManager(new MemoryStorageProvider());
      const orchestrator = new Orchestrator(
        eventStore,
        eventBus,
        storageManager,
        new DiscoveryEngine(),
        undefined,
        undefined,
        new SyntheticFaultyExtractor(),
      );

      const execution = await orchestrator.execute({
        id: runId,
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: {
          projectId,
          path: projectPath,
        },
      });

      // 1. Verify SymbolsExtractionFailure event was emitted for bad.js
      const failureEvents = eventStore.getByType("SymbolsExtractionFailure");
      expect(failureEvents).toHaveLength(1);
      expect(failureEvents[0]?.payload).toMatchObject({
        fileId: expect.any(String),
        path: "bad.js",
        code: "SYMBOL_EXTRACTION_SYNTHETIC_FAULT",
      });

      // 2. Verify SymbolsExtracted was emitted for good.js only
      const successEvents = eventStore.getByType("SymbolsExtracted");
      expect(successEvents).toHaveLength(1);
      expect(successEvents[0]?.payload).toMatchObject({
        path: "good.js",
        symbolCount: 2,
      });

      // 3. Verify storage records: symbol-table stored ONLY for good.js
      const storedTables = execution.records.filter((r) => r.type === "symbol-table");
      expect(storedTables).toHaveLength(1);
      expect(storedTables[0]?.payload).toMatchObject({
        path: "good.js",
        symbolCount: 2,
      });

      // 4. Verify File Accounting Reconciles Exactly:
      // filesDiscovered (2) = filesAnalyzed (1) + symbolExtractionFailures (1)
      expect(execution.analysis).toBeDefined();
      expect(execution.analysis!.filesDiscovered).toBe(2);
      expect(execution.analysis!.filesAnalyzed).toBe(1);
      expect(execution.analysis!.symbolExtractionFailures).toBe(1);
      expect(execution.analysis!.parserFailures).toBe(0);
      expect(execution.analysis!.unsupportedFiles).toBe(0);

      // 5. Downstream Analysis Succeeded without crashing
      const depGraphRecord = execution.records.find((r) => r.type === "dependency-graph");
      expect(depGraphRecord).toBeDefined();
      const semanticRecord = execution.records.find((r) => r.type === "semantic-analysis");
      expect(semanticRecord).toBeDefined();
      const flowRecord = execution.records.find((r) => r.type === "control-flow-analysis");
      expect(flowRecord).toBeDefined();
    });

    it("handles generic unhandled error during symbol extraction by classifying code as SYMBOL_EXTRACTION_FAILED", async () => {
      const projectPath = await createWorkspace();
      await writeFile(join(projectPath, "unhandled.js"), "export const x = 1;", "utf8");

      class CrashingExtractor extends JavaScriptSymbolExtractor {
        public override extract(): ReturnType<JavaScriptSymbolExtractor["extract"]> {
          // Throw a generic TypeError without a .code property
          throw new TypeError("Unexpected crash in third-party library");
        }
      }

      const eventStore = new InMemoryEventStore();
      const eventBus = new EventBus();
      const storageManager = new StorageManager(new MemoryStorageProvider());
      const orchestrator = new Orchestrator(
        eventStore,
        eventBus,
        storageManager,
        new DiscoveryEngine(),
        undefined,
        undefined,
        new CrashingExtractor(),
      );

      const execution = await orchestrator.execute({
        id: runId,
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: {
          projectId,
          path: projectPath,
        },
      });

      const failureEvents = eventStore.getByType("SymbolsExtractionFailure");
      expect(failureEvents).toHaveLength(1);
      expect(failureEvents[0]?.payload).toMatchObject({
        path: "unhandled.js",
        code: "SYMBOL_EXTRACTION_FAILED",
      });

      expect(execution.analysis!.filesDiscovered).toBe(1);
      expect(execution.analysis!.filesAnalyzed).toBe(0);
      expect(execution.analysis!.symbolExtractionFailures).toBe(1);
    });

    it("normalizes error codes by trimming whitespace and falls back when code is whitespace-only", async () => {
      const projectPath = await createWorkspace();
      await writeFile(join(projectPath, "padded.js"), "export const p = 1;", "utf8");
      await writeFile(join(projectPath, "blank.js"), "export const b = 2;", "utf8");

      class WhitespaceCodeExtractor extends JavaScriptSymbolExtractor {
        public override extract(ast: Parameters<JavaScriptSymbolExtractor["extract"]>[0]): ReturnType<JavaScriptSymbolExtractor["extract"]> {
          if (ast.metadata.sourcePath === "padded.js") {
            const err = new Error("Padded error code");
            (err as any).code = "  SYMBOL_PADDED_CODE  ";
            throw err;
          }
          if (ast.metadata.sourcePath === "blank.js") {
            const err = new Error("Blank error code");
            (err as any).code = "   ";
            throw err;
          }
          return super.extract(ast);
        }
      }

      const eventStore = new InMemoryEventStore();
      const eventBus = new EventBus();
      const storageManager = new StorageManager(new MemoryStorageProvider());
      const orchestrator = new Orchestrator(
        eventStore,
        eventBus,
        storageManager,
        new DiscoveryEngine(),
        undefined,
        undefined,
        new WhitespaceCodeExtractor(),
      );

      const execution = await orchestrator.execute({
        id: runId,
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: {
          projectId,
          path: projectPath,
        },
      });

      const failureEvents = eventStore.getByType("SymbolsExtractionFailure");
      expect(failureEvents).toHaveLength(2);

      const paddedEvent = failureEvents.find((e) => (e.payload as { readonly path?: unknown })?.path === "padded.js");
      expect(paddedEvent?.payload).toMatchObject({
        path: "padded.js",
        code: "SYMBOL_PADDED_CODE",
      });

      const blankEvent = failureEvents.find((e) => (e.payload as { readonly path?: unknown })?.path === "blank.js");
      expect(blankEvent?.payload).toMatchObject({
        path: "blank.js",
        code: "SYMBOL_EXTRACTION_FAILED",
      });

      expect(execution.analysis!.filesDiscovered).toBe(2);
      expect(execution.analysis!.symbolExtractionFailures).toBe(2);
    });
  });
});
