import type {
  AnalyzeProjectCommand,
  DiscoverProjectCommand,
  InitializeProjectCommand,
  UpdateKnowledgeCommand,
} from "@contracts/commands";
import {
  controlFlowPayloadSchema,
  dataFlowPayloadSchema,
  semanticAnalysisPayloadSchema,
} from "@contracts/discovery-storage";
import { createAnalysisSummary, type AnalysisSummary } from "@contracts/engine";
import type {
  FileDiscovered,
  KnowledgeUpdated,
  ProjectInitialized,
} from "@contracts/events";
import { createDomainEvent, type DomainEvent } from "@core/events/domain-event";
import { validateProjectDiscovery, type FileArtifact } from "@contracts/discovery";
import { DiscoveryEngine, DiscoveryValidator, type DiscoveryResult } from "@discovery/index";
import { DeterministicDependencyGraphBuilder, ModuleResolver, canonicalizePath, type ModuleResolutionOptions } from "@graph/index";
import { DeterministicControlFlowGraphBuilder, DeterministicDataFlowGraphBuilder, DeterministicFlowAnalysisEngine, createProvenCallTargets, type ControlFlowGraph, type BuildContextResult } from "@flow/index";
import { DeterministicKnowledgeGraphBuilder } from "@knowledge/index";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ParserManager, type ASTResult } from "@parser/index";
import { DeterministicCallGraphBuilder, DeterministicSemanticAnalysisEngine, findHttpCalls, type ExpressRoute, type MiddlewareChain, type SemanticCall, type SymbolReference } from "@semantic/index";
import { createStorageRecord, type StorageRecord } from "@storage/index";
import { JavaScriptSymbolExtractor, validateCodeSymbols, type CodeSymbol, type SymbolTable } from "@symbols/index";
import { RunScopedAstStore, type AnalysisAstStoreFactory } from "./run-scoped-ast-store";

export interface CommandExecution {
  readonly events: readonly DomainEvent[];
  readonly records: readonly StorageRecord[];
  readonly discovery?: DiscoveryResult;
  readonly analysis?: AnalysisSummary;
  readonly isReused?: boolean;
}

export interface AstStoreCleanupFailure {
  readonly projectId: string;
  readonly analysisRunId: string;
  readonly error: unknown;
}

export class InitializeProjectHandler {
  public handle(command: InitializeProjectCommand): CommandExecution {
    const event: ProjectInitialized = createDomainEvent({
      type: "ProjectInitialized",
      aggregateId: command.payload.projectId,
      payload: {
        projectId: command.payload.projectId,
        name: command.payload.name,
      },
    });

    return { events: Object.freeze([event]), records: Object.freeze([]) };
  }
}

export class DiscoverProjectHandler {
  public handle(command: DiscoverProjectCommand): CommandExecution {
    const event: FileDiscovered = createDomainEvent({
      type: "FileDiscovered",
      aggregateId: command.payload.projectId,
      payload: {
        fileId: command.payload.fileId,
        path: command.payload.path,
        language: command.payload.language,
      },
    });

    return { events: Object.freeze([event]), records: Object.freeze([]) };
  }
}

export class UpdateKnowledgeHandler {
  public handle(command: UpdateKnowledgeCommand): CommandExecution {
    const event: KnowledgeUpdated = createDomainEvent({
      type: "KnowledgeUpdated",
      aggregateId: command.payload.projectId,
      payload: {
        artifactId: command.payload.artifactId,
      },
    });

    return { events: Object.freeze([event]), records: Object.freeze([]) };
  }
}

export class AnalyzeProjectHandler {
  private astStoreCleanupFailures: AstStoreCleanupFailure[] = [];

  public constructor(
    private readonly discoveryEngine: DiscoveryEngine,
    private readonly parserManager: ParserManager,
    private readonly symbolExtractor: JavaScriptSymbolExtractor,
    private readonly discoveryValidator: DiscoveryValidator = new DiscoveryValidator(),
    private readonly astStoreFactory: AnalysisAstStoreFactory = () => RunScopedAstStore.create(),
  ) {}

  public getAstStoreCleanupFailures(): readonly AstStoreCleanupFailure[] {
    return Object.freeze([...this.astStoreCleanupFailures]);
  }

  public async handle(command: AnalyzeProjectCommand): Promise<CommandExecution> {
    this.astStoreCleanupFailures = [];
    const startedAt = performance.now();

    if (!command.payload.refresh) {
      const validation = await this.discoveryValidator.validate({
        projectPath: command.payload.path,
        verifyFreshness: true,
      });
      if (validation.valid && validation.manifest !== undefined && validation.validatedArtifacts !== undefined) {
        try {
          const artifacts = validation.validatedArtifacts;
          const projectRaw = artifacts.get("project.json");
          const filesRaw = artifacts.get("files.json");
          const depsRaw = artifacts.get("dependencies.json");
          const frameworksRaw = artifacts.get("frameworks.json");

          if (!projectRaw || !filesRaw || !depsRaw || !frameworksRaw) {
            throw new Error("Missing required discovery artifact in validated set.");
          }

          const projectJson = JSON.parse(projectRaw);
          const filesJson = JSON.parse(filesRaw) as readonly any[];
          const depsJson = JSON.parse(depsRaw) as readonly any[];
          const frameworksJson = JSON.parse(frameworksRaw) as readonly any[];

          const discovery = validateProjectDiscovery({
            projectId: command.payload.projectId,
            projectName: projectJson.name ?? validation.manifest.repository.name,
            projectPath: command.payload.path,
            files: filesJson.map((f) => ({
              id: f.id,
              path: f.path,
              language: f.language,
              ...(f.fileKind !== undefined ? { fileKind: f.fileKind } : {}),
              size: f.size,
            })),
            dependencies: depsJson.map((d) => ({
              name: d.name,
              version: d.version,
              kind: d.kind,
            })),
            frameworks: frameworksJson.map((f) => ({
              name: f.name,
              evidence: f.evidence,
            })),
            languages: projectJson.languages ?? [],
            enumerationFailures: [],
            manifestFailures: projectJson.manifestFailures ?? [],
            discoveredAt: new Date(validation.manifest.analysis.generatedAt),
          });

          const record = createStorageRecord("project-discovery", {
            projectId: discovery.projectId,
            projectName: discovery.projectName,
            projectPath: discovery.projectPath,
            files: discovery.files.map((file) => ({ ...file })),
            dependencies: discovery.dependencies.map((dependency) => ({ ...dependency })),
            frameworks: discovery.frameworks.map((framework) => ({ ...framework })),
            languages: [...discovery.languages],
            enumerationFailures: [],
            manifestFailures: discovery.manifestFailures.map((failure) => ({ ...failure })),
            discoveredAt: discovery.discoveredAt.toISOString(),
            analysisRunId: command.id,
          });

          const records: StorageRecord[] = [record];

          const required = new Set(validation.manifest.requiredArtifacts);
          const analyzableFiles = discovery.files.filter(
            (file) =>
              (file.language === "javascript" || file.language === "typescript") &&
              (file.fileKind === "source" || file.fileKind === undefined),
          );

          // If project has analyzable source files, the snapshot must contain analysis artifacts
          if (analyzableFiles.length > 0 && (!required.has("dependency-graph.json") || !required.has("symbols.json"))) {
            throw new Error("Snapshot contains discovery only; falling through to full analysis.");
          }

          if (required.has("dependency-graph.json")) {
            const depGraphRaw = artifacts.get("dependency-graph.json");
            if (!depGraphRaw) throw new Error("Missing dependency-graph.json in validated set.");
            const depGraphJson = JSON.parse(depGraphRaw);
            records.push(
              createStorageRecord("dependency-graph", {
                projectId: discovery.projectId,
                analysisRunId: command.id,
                nodes: depGraphJson.nodes ?? [],
                edges: depGraphJson.edges ?? [],
                cycles: depGraphJson.cycles ?? [],
              }),
            );
          }

          if (required.has("symbols.json")) {
            const symbolsRaw = artifacts.get("symbols.json");
            if (!symbolsRaw) throw new Error("Missing symbols.json in validated set.");
            const symbolsJson = validateCodeSymbols(JSON.parse(symbolsRaw));
            const symbolsByFile = new Map<string, CodeSymbol[]>();
            for (const symbol of symbolsJson) {
              let list = symbolsByFile.get(symbol.filePath);
              if (!list) {
                list = [];
                symbolsByFile.set(symbol.filePath, list);
              }
              list.push(symbol);
            }

            for (const file of analyzableFiles) {
              const fileSymbols = symbolsByFile.get(file.path) ?? [];
              records.push(
                createStorageRecord("symbol-table", {
                  fileId: file.id,
                  path: file.path,
                  projectId: discovery.projectId,
                  analysisRunId: command.id,
                  symbolCount: fileSymbols.length,
                  classes: fileSymbols.filter((s) => s.kind === "class").length,
                  functions: fileSymbols.filter((s) => s.kind === "function").length,
                  imports: fileSymbols.filter((s) => s.kind === "import").length,
                  exports: fileSymbols.filter((s) => s.exported === true).length,
                  symbols: fileSymbols,
                }),
              );
            }
          }

          if (required.has("knowledge.json")) {
            const knowledgeRaw = artifacts.get("knowledge.json");
            if (!knowledgeRaw) throw new Error("Missing knowledge.json in validated set.");
            const knowledgeJson = JSON.parse(knowledgeRaw);
            records.push(
              createStorageRecord("knowledge-graph", {
                projectId: discovery.projectId,
                analysisRunId: command.id,
                nodes: knowledgeJson.nodes ?? [],
                edges: knowledgeJson.edges ?? [],
              }),
            );
          }

          if (required.has("semantic.json")) {
            const semanticRaw = artifacts.get("semantic.json");
            if (!semanticRaw) throw new Error("Missing semantic.json in validated set.");
            const semanticJson = JSON.parse(semanticRaw);
            records.push(
              createStorageRecord("semantic-analysis", semanticAnalysisPayloadSchema.parse({
                ...semanticJson,
                projectId: discovery.projectId,
                analysisRunId: command.id,
              })),
            );
          }

          if (required.has("control-flow.json")) {
            const cfgRaw = artifacts.get("control-flow.json");
            if (!cfgRaw) throw new Error("Missing control-flow.json in validated set.");
            const cfgJson = JSON.parse(cfgRaw);
            records.push(
              createStorageRecord("control-flow-analysis", controlFlowPayloadSchema.parse({
                ...cfgJson,
                projectId: discovery.projectId,
                analysisRunId: command.id,
              })),
            );
          }

          if (required.has("data-flow.json")) {
            const dfgRaw = artifacts.get("data-flow.json");
            if (!dfgRaw) throw new Error("Missing data-flow.json in validated set.");
            const dfgJson = JSON.parse(dfgRaw);
            records.push(
              createStorageRecord("data-flow-analysis", dataFlowPayloadSchema.parse({
                ...dfgJson,
                projectId: discovery.projectId,
                analysisRunId: command.id,
              })),
            );
          }

          const durationMs = performance.now() - startedAt;
          const analyzedCount = analyzableFiles.length;

          const analysisSummary = createAnalysisSummary({
            filesDiscovered: discovery.files.length,
            filesAnalyzed: analyzedCount,
            parserFailures: 0,
            symbolExtractionFailures: 0,
            unsupportedFiles: discovery.files.filter(
              (file) => file.fileKind === "source" && file.language !== "javascript" && file.language !== "typescript",
            ).length,
            nonSourceArtifacts: discovery.files.filter(
              (file) => file.fileKind !== "source" && file.fileKind !== "unknown" && file.fileKind !== undefined,
            ).length,
            unclassifiedArtifacts: discovery.files.filter(
              (file) => file.fileKind === "unknown" || file.fileKind === undefined,
            ).length,
            enumerationFailures: 0,
            discoveryComplete: discovery.manifestFailures.length === 0,
            durationMs,
          });

          const runRecord = createStorageRecord("analysis-run", {
            projectId: discovery.projectId,
            analysisRunId: command.id,
            status: "completed",
            startedAt: discovery.discoveredAt.toISOString(),
            completedAt: new Date().toISOString(),
            summary: {
              filesDiscovered: analysisSummary.filesDiscovered,
              filesAnalyzed: analysisSummary.filesAnalyzed,
              parserFailures: analysisSummary.parserFailures,
              symbolExtractionFailures: analysisSummary.symbolExtractionFailures,
              unsupportedFiles: analysisSummary.unsupportedFiles,
              nonSourceArtifacts: analysisSummary.nonSourceArtifacts,
              unclassifiedArtifacts: analysisSummary.unclassifiedArtifacts,
              enumerationFailures: analysisSummary.enumerationFailures,
              discoveryComplete: analysisSummary.discoveryComplete,
              durationMs: analysisSummary.durationMs,
            },
          });
          records.push(runRecord);

          const events: DomainEvent[] = [
            ...this.discoveryEngine.createEvents(discovery),
            createDomainEvent({
              type: "AnalysisRunCompleted",
              aggregateId: discovery.projectId,
              payload: {
                projectId: discovery.projectId,
                analysisRunId: command.id,
                durationMs,
              },
            }),
          ];

          return {
            events: Object.freeze(events),
            records: Object.freeze(records),
            discovery,
            analysis: analysisSummary,
            isReused: true,
          };
        } catch {
          // If reading or parsing snapshot failed unexpectedly, fall through to fresh discovery
        }
      }
    }

    const discovery = await this.discoveryEngine.discover({
      projectId: command.payload.projectId,
      projectPath: command.payload.path,
    });
    const enumerationFailures = discovery.enumerationFailures ?? [];
    const record = createStorageRecord("project-discovery", {
      projectId: discovery.projectId,
      projectName: discovery.projectName,
      projectPath: discovery.projectPath,
      files: discovery.files.map((file) => ({ ...file })),
      dependencies: discovery.dependencies.map((dependency) => ({ ...dependency })),
      frameworks: discovery.frameworks.map((framework) => ({ ...framework })),
      languages: [...discovery.languages],
      enumerationFailures: enumerationFailures.map((failure) => ({ ...failure })),
      manifestFailures: discovery.manifestFailures.map((failure) => ({ ...failure })),
      discoveredAt: discovery.discoveredAt.toISOString(),
      analysisRunId: command.id,
    });

    const events: DomainEvent[] = [...this.discoveryEngine.createEvents(discovery)];
    const records: StorageRecord[] = [record];
    const symbolTables: SymbolTable[] = [];
    const successfullyParsedFiles: FileArtifact[] = [];
    const astStore = await this.astStoreFactory();

    try {
      for (const file of discovery.files) {
        if (file.language !== "javascript" && file.language !== "typescript") {
          continue;
        }

        let ast: ASTResult;
        try {
          ast = await this.parserManager.parse({
            file,
            source: await readFile(resolve(discovery.projectPath, file.path), "utf8"),
          });
        } catch (error: unknown) {
          events.push(createDomainEvent({
            type: "ParserFailure",
            aggregateId: discovery.projectId,
            payload: { fileId: file.id, path: file.path, code: getErrorCode(error, "PARSER_FAILURE") },
          }));
          continue;
        }
        if (ast.errors.length > 0) {
          events.push(createDomainEvent({
            type: "ParserFailure",
            aggregateId: discovery.projectId,
            payload: { fileId: file.id, path: file.path, code: ast.errors[0]?.code ?? "PARSER_FAILURE" },
          }));
          continue;
        }
        records.push(
          createStorageRecord("ast-result", {
            fileId: file.id,
            path: file.path,
            projectId: discovery.projectId,
            analysisRunId: command.id,
            parserId: ast.metadata.parserId,
            nodeCount: ast.statistics.nodeCount,
            errorCount: ast.errors.length,
          }),
        );
        events.push(
          createDomainEvent({
            type: "FileParsed",
            aggregateId: discovery.projectId,
            payload: {
              fileId: file.id,
              path: file.path,
              parserId: ast.metadata.parserId,
              nodeCount: ast.statistics.nodeCount,
              errorCount: ast.errors.length,
            },
          }),
        );

        let table: SymbolTable;
        try {
          table = this.symbolExtractor.extract(ast);
        } catch (error: unknown) {
          events.push(createDomainEvent({
            type: "SymbolsExtractionFailure",
            aggregateId: discovery.projectId,
            payload: { fileId: file.id, path: file.path, code: getErrorCode(error, "SYMBOL_EXTRACTION_FAILED") },
          }));
          continue;
        }
        await astStore.write(ast);
        successfullyParsedFiles.push(file);
        symbolTables.push(table);
        records.push(
          createStorageRecord("symbol-table", {
            fileId: file.id,
            path: file.path,
            projectId: discovery.projectId,
            analysisRunId: command.id,
            symbolCount: table.symbols.length,
            classes: table.summary.classes,
            functions: table.summary.functions,
            imports: table.summary.imports,
            exports: table.summary.exports,
            symbols: table.symbols,
          }),
        );
        events.push(
          createDomainEvent({
            type: "SymbolsExtracted",
            aggregateId: discovery.projectId,
            payload: { fileId: file.id, path: file.path, symbolCount: table.symbols.length },
          }),
        );
      }

      const dependencyGraph = new DeterministicDependencyGraphBuilder(
        new ModuleResolver(await readPathAliases(discovery.projectPath)),
      ).build(symbolTables, discovery.files);
      records.push(
        createStorageRecord("dependency-graph", {
          projectId: discovery.projectId,
          analysisRunId: command.id,
          nodes: dependencyGraph.nodes,
          edges: dependencyGraph.edges,
          cycles: dependencyGraph.cycles,
        }),
      );
      const tablesByPath = new Map(symbolTables.map((table) => [canonicalizePath(table.filePath), table]));
      const symbolsByPath = new Map(symbolTables.map((table) => [canonicalizePath(table.filePath), table.symbols]));
      const importsByFile = new Map(symbolTables.map((table) => [canonicalizePath(table.filePath), table.symbols.filter((symbol) => symbol.kind === "import")]));
      const targetByImportId = new Map(dependencyGraph.edges.map((edge) => [edge.importSymbolId, edge.targetExportSymbolId]));

      const callGraphBuilder = new DeterministicCallGraphBuilder();
      const controlFlowBuilder = new DeterministicControlFlowGraphBuilder();
      const dataFlowBuilder = new DeterministicDataFlowGraphBuilder();

      let allCalls: SemanticCall[] | undefined = [];
      let allReferences: SymbolReference[] | undefined = [];
      let allHttpCalls: { readonly routes: readonly ExpressRoute[]; readonly middlewareChains: readonly MiddlewareChain[] }[] | undefined = [];
      const allControlFlowGraphs: ControlFlowGraph[] = [];
      let allContexts: BuildContextResult[] | undefined = [];

      const sortedFiles = [...successfullyParsedFiles].sort((left, right) => left.path.localeCompare(right.path));
      const completedFiles: FileArtifact[] = [];

      for (const file of sortedFiles) {
        let ast: ASTResult | undefined;
        try {
          ast = await astStore.read(file.path);
        } catch (error: unknown) {
          events.push(createDomainEvent({
            type: "ParserFailure",
            aggregateId: discovery.projectId,
            payload: { fileId: file.id, path: file.path, code: getErrorCode(error, "PARSER_FAILURE") },
          }));
          continue;
        }

        if (ast.errors.length > 0) {
          events.push(createDomainEvent({
            type: "ParserFailure",
            aggregateId: discovery.projectId,
            payload: { fileId: file.id, path: file.path, code: ast.errors[0]?.code ?? "PARSER_FAILURE" },
          }));
          continue;
        }

        completedFiles.push(file);

        const fileCalls: SemanticCall[] = [];
        const fileReferences: SymbolReference[] = [];
        callGraphBuilder.buildForFile(ast, tablesByPath, importsByFile, targetByImportId, fileCalls, fileReferences);
        allCalls.push(...fileCalls);
        allReferences.push(...fileReferences);

        const httpCalls = findHttpCalls(
          ast.root,
          file.path,
          tablesByPath.get(canonicalizePath(file.path)),
        );
        allHttpCalls.push(httpCalls);

        const cfgs = controlFlowBuilder.buildAll(ast);
        allControlFlowGraphs.push(...cfgs);

        const provenTargets = createProvenCallTargets(
          fileCalls.flatMap((call) =>
            canonicalizePath(call.sourceFilePath) === canonicalizePath(file.path) && call.resolutionState === "RESOLVED" && call.targetSymbolId !== undefined && call.location !== undefined
              ? [{ callId: call.id, sourceFilePath: call.sourceFilePath, location: call.location, targetSymbolId: call.targetSymbolId }]
              : [],
          ),
        );
        const contextResult = dataFlowBuilder.buildContext(
          ast,
          provenTargets,
          symbolsByPath.get(canonicalizePath(file.path)) ?? [],
        );
        allContexts.push(contextResult);

        ast = undefined;
      }

      const semanticEngine = new DeterministicSemanticAnalysisEngine(callGraphBuilder);
      const semantic = semanticEngine.synthesize({
        calls: allCalls,
        references: allReferences,
        symbolTables,
        dependencyGraph,
        filePaths: completedFiles.map((file) => file.path),
        httpCalls: allHttpCalls,
      });
      allCalls = undefined;
      allReferences = undefined;
      allHttpCalls = undefined;

      records.push(
        createStorageRecord("semantic-analysis", {
          projectId: discovery.projectId,
          analysisRunId: command.id,
          calls: semantic.calls,
          references: semantic.references,
          scopes: semantic.scopes,
          deadCode: semantic.deadCode,
          unusedImports: semantic.unusedImports,
          unusedExports: semantic.unusedExports,
          entryPoints: semantic.entryPoints,
          routes: semantic.routes,
          middlewareChains: semantic.middlewareChains,
        }),
      );

      const flowEngine = new DeterministicFlowAnalysisEngine(controlFlowBuilder, dataFlowBuilder);
      const flow = flowEngine.connect(allControlFlowGraphs, allContexts, symbolTables);
      allContexts = undefined;

      records.push(
        createStorageRecord("control-flow-analysis", {
          projectId: discovery.projectId,
          analysisRunId: command.id,
          graphs: flow.controlFlowGraphs,
        }),
      );
      records.push(
        createStorageRecord("data-flow-analysis", {
          projectId: discovery.projectId,
          analysisRunId: command.id,
          graphs: flow.dataFlowGraphs.map((graph) => ({
            ...graph,
            callBindings: graph.callBindings.map((binding) => ({
              callId: binding.callId,
              targetSymbolId: binding.targetSymbolId,
              argumentDefinitionIds: binding.argumentDefinitionIds.map((definitionId) => definitionId ?? null),
              ...(binding.receiverDefinitionId === undefined ? {} : { receiverDefinitionId: binding.receiverDefinitionId }),
            })),
          })),
        }),
      );
      const knowledgeGraph = new DeterministicKnowledgeGraphBuilder().build(symbolTables, dependencyGraph);
      records.push(
        createStorageRecord("knowledge-graph", {
          projectId: discovery.projectId,
          analysisRunId: command.id,
          nodes: knowledgeGraph.nodes,
          edges: knowledgeGraph.edges,
        }),
      );

      const durationMs = performance.now() - startedAt;
      const analysisSummary = createAnalysisSummary({
        filesDiscovered: discovery.files.length,
        filesAnalyzed: symbolTables.length,
        parserFailures: events.filter((event) => event.type === "ParserFailure").length,
        symbolExtractionFailures: events.filter((event) => event.type === "SymbolsExtractionFailure").length,
        unsupportedFiles: discovery.files.filter((file) => file.fileKind === "source" && file.language !== "javascript" && file.language !== "typescript").length,
        nonSourceArtifacts: discovery.files.filter((file) => file.fileKind !== "source" && file.fileKind !== "unknown" && file.fileKind !== undefined).length,
        unclassifiedArtifacts: discovery.files.filter((file) => file.fileKind === "unknown" || file.fileKind === undefined).length,
        enumerationFailures: enumerationFailures.length,
        discoveryComplete: enumerationFailures.length === 0 && discovery.manifestFailures.length === 0,
        durationMs,
      });

      records.push(
        createStorageRecord("analysis-run", {
          projectId: discovery.projectId,
          analysisRunId: command.id,
          status: "completed",
          startedAt: discovery.discoveredAt.toISOString(),
          completedAt: new Date().toISOString(),
          summary: {
            filesDiscovered: analysisSummary.filesDiscovered,
            filesAnalyzed: analysisSummary.filesAnalyzed,
            parserFailures: analysisSummary.parserFailures,
            symbolExtractionFailures: analysisSummary.symbolExtractionFailures,
            unsupportedFiles: analysisSummary.unsupportedFiles,
            nonSourceArtifacts: analysisSummary.nonSourceArtifacts,
            unclassifiedArtifacts: analysisSummary.unclassifiedArtifacts,
            enumerationFailures: analysisSummary.enumerationFailures,
            discoveryComplete: analysisSummary.discoveryComplete,
            durationMs: analysisSummary.durationMs,
          },
        }),
      );

      events.push(
        createDomainEvent({
          type: "AnalysisRunCompleted",
          aggregateId: discovery.projectId,
          payload: {
            projectId: discovery.projectId,
            analysisRunId: command.id,
            durationMs,
          },
        }),
      );

      return {
        events: Object.freeze(events),
        records: Object.freeze(records),
        discovery,
        analysis: analysisSummary,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      const failedRecords: StorageRecord[] = [
        createStorageRecord("analysis-run", {
          projectId: discovery.projectId,
          analysisRunId: command.id,
          status: "failed",
          startedAt: discovery.discoveredAt.toISOString(),
          completedAt: new Date().toISOString(),
          error: errorMessage,
        }),
      ];

      const failedEvents: DomainEvent[] = [
        ...events,
        createDomainEvent({
          type: "AnalysisRunFailed",
          aggregateId: discovery.projectId,
          payload: {
            projectId: discovery.projectId,
            analysisRunId: command.id,
            error: errorMessage,
          },
        }),
      ];

      return {
        events: Object.freeze(failedEvents),
        records: Object.freeze(failedRecords),
        discovery,
      };
    } finally {
      try {
        await astStore.dispose();
      } catch (error: unknown) {
        this.astStoreCleanupFailures.push(Object.freeze({
          projectId: discovery.projectId,
          analysisRunId: command.id,
          error,
        }));
      }
    }
  }
}

async function readPathAliases(projectPath: string): Promise<ModuleResolutionOptions> {
  try {
    const parsed: unknown = JSON.parse(await readFile(resolve(projectPath, "tsconfig.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("compilerOptions" in parsed)) return {};
    const compilerOptions = (parsed as { readonly compilerOptions: unknown }).compilerOptions;
    if (typeof compilerOptions !== "object" || compilerOptions === null) return {};
    const options = compilerOptions as { readonly baseUrl?: unknown; readonly paths?: unknown };
    const paths = typeof options.paths === "object" && options.paths !== null
      ? Object.fromEntries(Object.entries(options.paths).flatMap(([key, targets]) => Array.isArray(targets) && targets.every((target) => typeof target === "string") ? [[key, Object.freeze([...targets].sort())]] : []))
      : undefined;
    return { ...(typeof options.baseUrl === "string" ? { baseUrl: options.baseUrl } : {}), ...(paths === undefined ? {} : { paths }) };
  } catch { return {}; }
}

function getErrorCode(error: unknown, fallback = "UNKNOWN_ERROR"): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code: unknown }).code;
    if (typeof code === "string") {
      const trimmed = code.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return fallback;
}
