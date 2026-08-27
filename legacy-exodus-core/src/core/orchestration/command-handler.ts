import type {
  AnalyzeProjectCommand,
  DiscoverProjectCommand,
  InitializeProjectCommand,
  UpdateKnowledgeCommand,
} from "@contracts/commands";
import { createAnalysisSummary, type AnalysisSummary } from "@contracts/engine";
import type {
  FileDiscovered,
  KnowledgeUpdated,
  ProjectInitialized,
} from "@contracts/events";
import { createDomainEvent, type DomainEvent } from "@core/events/domain-event";
import { DiscoveryEngine, type DiscoveryResult } from "@discovery/index";
import { DeterministicDependencyGraphBuilder, ModuleResolver, type ModuleResolutionOptions } from "@graph/index";
import { DeterministicFlowAnalysisEngine } from "@flow/index";
import { DeterministicKnowledgeGraphBuilder } from "@knowledge/index";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ParserManager, type ASTResult } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { createStorageRecord, type StorageRecord } from "@storage/index";
import { JavaScriptSymbolExtractor, type SymbolTable } from "@symbols/index";

export interface CommandExecution {
  readonly events: readonly DomainEvent[];
  readonly records: readonly StorageRecord[];
  readonly discovery?: DiscoveryResult;
  readonly analysis?: AnalysisSummary;
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
  public constructor(
    private readonly discoveryEngine: DiscoveryEngine,
    private readonly parserManager: ParserManager,
    private readonly symbolExtractor: JavaScriptSymbolExtractor,
  ) {}

  public async handle(command: AnalyzeProjectCommand): Promise<CommandExecution> {
    const startedAt = performance.now();
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
      discoveredAt: discovery.discoveredAt.toISOString(),
      analysisRunId: command.id,
    });

    const events: DomainEvent[] = [...this.discoveryEngine.createEvents(discovery)];
    const records: StorageRecord[] = [record];
    const symbolTables: SymbolTable[] = [];
    const astResults: ASTResult[] = [];

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
          payload: { fileId: file.id, path: file.path, code: getErrorCode(error) },
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
          payload: { fileId: file.id, path: file.path, code: getErrorCode(error) },
        }));
        continue;
      }
      astResults.push(ast);
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
          symbols: table.symbols.map((symbol) => ({
            id: symbol.id, kind: symbol.kind, name: symbol.name, filePath: symbol.filePath,
            exported: symbol.exported, defaultExport: symbol.defaultExport,
            moduleSpecifier: symbol.moduleSpecifier ?? null,
            sourceSymbolName: symbol.sourceSymbolName ?? null,
          })),
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
    const semantic = new DeterministicSemanticAnalysisEngine().analyze({
      astResults,
      dependencyGraph,
      symbolTables,
    });
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
    const flow = new DeterministicFlowAnalysisEngine().analyze(astResults, semantic.calls, symbolTables);
    astResults.length = 0;

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
      discoveryComplete: enumerationFailures.length === 0,
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

function getErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }

  return "PARSER_FAILURE";
}
