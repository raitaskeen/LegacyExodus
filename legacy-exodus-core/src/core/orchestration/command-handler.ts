import { createAnalysisDisposition, deriveR01Accounting, isR01DispatchedFile, validateAnalysisDisposition, type AnalysisFileDisposition } from "@contracts/discovery-projection";
import type {
  AnalyzeProjectCommand,
  DiscoverProjectCommand,
  InitializeProjectCommand,
  UpdateKnowledgeCommand,
} from "@contracts/commands";
import {
  knowledgeGraphPayloadSchema,
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
import { DeterministicDependencyGraphBuilder, ModuleResolver, canonicalizePath, findPackageEntryFiles, loadTsConfigResolution, loadWorkspacePackages, validateCurrentDependencyGraph, type TsConfigDiagnostic } from "@graph/index";
import { DeterministicControlFlowGraphBuilder, DeterministicDataFlowGraphBuilder, DeterministicFlowAnalysisEngine, createProvenCallTargets, type ConnectionContext, type ControlFlowGraph, type DataFlowGraphBody } from "@flow/index";
import { DeterministicKnowledgeGraphBuilder } from "@knowledge/index";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ParserManager, type ASTResult } from "@parser/index";
import { callSchema, collectUnstableExportIds, DeterministicCallGraphBuilder, DeterministicSemanticAnalysisEngine, FactUsage, findHttpCalls, referenceSchema, SortedFactList, type ExpressRoute, type MiddlewareChain, type SemanticAnalysis, type SemanticCall, type SymbolReference } from "@semantic/index";
import { createOwnedStorageRecord, createStorageRecord, type StorageRecord } from "@storage/index";
import { JavaScriptSymbolExtractor, validateCodeSymbols, type CodeSymbol, type SymbolTable } from "@symbols/index";
import { RunScopedAstStore, type AnalysisAstStoreFactory } from "./run-scoped-ast-store";
import { compareCodePoints } from "@shared/ordering";
import { FactStore, toFactArray, type FactArray, type FactSpool } from "@shared/fact-array";

export interface CommandExecution {
  readonly events: readonly DomainEvent[];
  readonly records: readonly StorageRecord[];
  readonly discovery?: DiscoveryResult;
  readonly analysis?: AnalysisSummary;
  readonly isReused?: boolean;
  /** Analysis run that produced the reused snapshot, when the manifest records it. */
  readonly snapshotAnalysisRunId?: string;
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
  private tsConfigDiagnostics: readonly TsConfigDiagnostic[] = [];
  /** Holds the fact lists of every run's records; it lives until `disposeFacts` (engine shutdown). */
  private facts: FactStore | undefined;

  public constructor(
    private readonly discoveryEngine: DiscoveryEngine,
    private readonly parserManager: ParserManager,
    private readonly symbolExtractor: JavaScriptSymbolExtractor,
    private readonly discoveryValidator: DiscoveryValidator = new DiscoveryValidator(),
    private readonly astStoreFactory: AnalysisAstStoreFactory = () => RunScopedAstStore.create(),
  ) {}

  /** Removes the fact lists of all runs; records made by this handler cannot be read after it. */
  public disposeFacts(): void {
    this.facts?.dispose();
    this.facts = undefined;
  }

  private factStore(): FactStore {
    this.facts ??= FactStore.create();
    return this.facts;
  }

  public getAstStoreCleanupFailures(): readonly AstStoreCleanupFailure[] {
    return Object.freeze([...this.astStoreCleanupFailures]);
  }

  /** What the last run could not use of the project's tsconfig.json / jsconfig.json; empty when it was read in full. */
  public getTsConfigDiagnostics(): readonly TsConfigDiagnostic[] {
    return this.tsConfigDiagnostics;
  }

  public async handle(command: AnalyzeProjectCommand): Promise<CommandExecution> {
    this.astStoreCleanupFailures = [];
    this.tsConfigDiagnostics = [];
    const startedAt = performance.now();

    if (!command.payload.refresh) {
      // Reuse requires an authenticated snapshot of this exact location from this analyzer build.
      const validation = await this.discoveryValidator.validate({
        projectPath: command.payload.path,
        verifyFreshness: true,
        authorizeReuse: true,
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
          const summaryRaw = artifacts.get("summary.json");
          if (summaryRaw === undefined) throw new Error("Missing R01 summary.");
          const snapshotSummary = JSON.parse(summaryRaw);
          const enumerationRaw = artifacts.get("enumeration-failures.json");
          const snapshotEnumeration = enumerationRaw === undefined ? [] : JSON.parse(enumerationRaw);

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
              ...(d.manifest !== undefined ? { manifest: d.manifest } : {}),
            })),
            frameworks: frameworksJson.map((f) => ({
              name: f.name,
              evidence: f.evidence,
            })),
            languages: projectJson.languages ?? [],
            enumerationFailures: snapshotEnumeration,
            manifestFailures: projectJson.manifestFailures ?? [],
            excludedPaths: projectJson.excludedPaths ?? [],
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
            enumerationFailures: discovery.enumerationFailures,
            manifestFailures: discovery.manifestFailures.map((failure) => ({ ...failure })),
            ...(discovery.excludedPaths.length === 0 ? {} : { excludedPaths: discovery.excludedPaths.map((excluded) => ({ ...excluded })) }),
            discoveredAt: discovery.discoveredAt.toISOString(),
            analysisRunId: command.id,
          });

          const records: StorageRecord[] = [record];

          const required = new Set(validation.manifest.requiredArtifacts);
          for (const artifact of ["symbols.json", "dependency-graph.json", "knowledge.json", "semantic.json", "control-flow.json", "data-flow.json"]) {
            if (!required.has(artifact) || !artifacts.has(artifact)) throw new Error("Missing current analysis artifact.");
          }
          if (discovery.enumerationFailures.length > 0) throw new Error("Enumeration-degraded snapshots require fresh discovery.");
          if (snapshotSummary.fileCount !== discovery.files.length ||
            snapshotSummary.enumerationFailureCount !== discovery.enumerationFailures.length ||
            (snapshotSummary.manifestFailureCount ?? 0) !== discovery.manifestFailures.length) {
            throw new Error("Snapshot discovery counts contradict diagnostics.");
          }
          const snapshotSymbols = validateCodeSymbols(JSON.parse(artifacts.get("symbols.json")!));
          const analysisDisposition = validateAnalysisDisposition(snapshotSummary.analysisDisposition, {
            files: discovery.files, symbols: snapshotSymbols, summary: snapshotSummary,
            enumerationFailures: discovery.enumerationFailures.length,
            manifestFailures: discovery.manifestFailures.length, projected: true,
          });

          if (required.has("dependency-graph.json")) {
            const depGraphRaw = artifacts.get("dependency-graph.json");
            if (!depGraphRaw) throw new Error("Missing dependency-graph.json in validated set.");
            const depGraphJson = validateCurrentDependencyGraph(JSON.parse(depGraphRaw));
            records.push(
              createStorageRecord("dependency-graph", {
                projectId: discovery.projectId,
                analysisRunId: command.id,
                nodes: depGraphJson.nodes ?? [],
                edges: depGraphJson.edges ?? [],
                cycles: depGraphJson.cycles ?? [],
                moduleGraph: depGraphJson.moduleGraph,
              }),
            );
          }

          if (required.has("symbols.json")) {
            const symbolsRaw = artifacts.get("symbols.json");
            if (!symbolsRaw) throw new Error("Missing symbols.json in validated set.");
            const symbolsJson = snapshotSymbols;
            const symbolsByFile = new Map<string, CodeSymbol[]>();
            for (const symbol of symbolsJson) {
              let list = symbolsByFile.get(symbol.filePath);
              if (!list) {
                list = [];
                symbolsByFile.set(symbol.filePath, list);
              }
              list.push(symbol);
            }

            for (const file of analysisDisposition.files.filter((file) => file.kind === "analyzed")) {
              const fileSymbols = symbolsByFile.get(file.path) ?? [];
              records.push(
                createStorageRecord("symbol-table", {
                  fileId: file.fileId,
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
            const knowledgeJson = knowledgeGraphPayloadSchema.parse({ ...JSON.parse(knowledgeRaw), projectId: discovery.projectId, analysisRunId: command.id });
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
          const analysisSummary = createAnalysisSummary({
            ...deriveR01Accounting(analysisDisposition, discovery.files, discovery.enumerationFailures.length, discovery.manifestFailures.length),
            durationMs,
          });

          const runRecord = createStorageRecord("analysis-run", {
            projectId: discovery.projectId,
            analysisRunId: command.id,
            status: "completed",
            analysisDisposition,
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
              secondPassFailures: analysisSummary.secondPassFailures,
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
            ...(validation.manifest.analysis.analysisRunId === undefined
              ? {}
              : { snapshotAnalysisRunId: validation.manifest.analysis.analysisRunId }),
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
      ...(discovery.excludedPaths.length === 0 ? {} : { excludedPaths: discovery.excludedPaths.map((excluded) => ({ ...excluded })) }),
      discoveredAt: discovery.discoveredAt.toISOString(),
      analysisRunId: command.id,
    });

    const events: DomainEvent[] = [...this.discoveryEngine.createEvents(discovery)];
    const records: StorageRecord[] = [record];
    /** Each table's cross-file summary (ADR-009 step 2); the full tables wait on disk, in `fullSymbols`. */
    const symbolTables: SymbolTable[] = [];
    const fullSymbols = new Map<SymbolTable, FactArray<CodeSymbol>>();
    const fullTable = (summary: SymbolTable): SymbolTable => ({ ...summary, symbols: [...fullSymbols.get(summary)!] });
    // Every full table, one at a time, in pass-1 order.
    const fullTables = function* (): Generator<SymbolTable> { for (const summary of symbolTables) yield fullTable(summary); };
    // Exports reassigned by their own module; the call graph must know them before any importer is built.
    const unstableExportIds = new Set<string>();
    const dispositions = new Map<string, AnalysisFileDisposition>();
    const successfullyParsedFiles: FileArtifact[] = [];
    const astStore = await this.astStoreFactory();
    // Full symbol tables, one list per file, in one file (ADR-009 step 2).
    let symbolSpool: FactSpool | undefined;

    try {
      for (const file of discovery.files) {
        if (!isR01DispatchedFile(file)) {
          continue;
        }

        let ast: ASTResult;
        try {
          ast = await this.parserManager.parse({
            file,
            source: await readFile(resolve(discovery.projectPath, file.path), "utf8"),
          });
        } catch (error: unknown) {
          dispositions.set(file.id, { fileId: file.id, path: file.path, kind: "initial-parser-failure", code: getErrorCode(error, "PARSER_FAILURE") });
          events.push(createDomainEvent({
            type: "ParserFailure",
            aggregateId: discovery.projectId,
            payload: { fileId: file.id, path: file.path, code: getErrorCode(error, "PARSER_FAILURE") },
          }));
          continue;
        }
        if (ast.errors.length > 0) {
          dispositions.set(file.id, { fileId: file.id, path: file.path, kind: "initial-parser-failure", code: ast.errors[0]?.code ?? "PARSER_FAILURE" });
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
          dispositions.set(file.id, { fileId: file.id, path: file.path, kind: "symbol-extraction-failure", code: getErrorCode(error, "SYMBOL_EXTRACTION_FAILED") });
          events.push(createDomainEvent({
            type: "SymbolsExtractionFailure",
            aggregateId: discovery.projectId,
            payload: { fileId: file.id, path: file.path, code: getErrorCode(error, "SYMBOL_EXTRACTION_FAILED") },
          }));
          continue;
        }
        for (const id of collectUnstableExportIds(ast, table)) unstableExportIds.add(id);
        await astStore.write(ast);
        successfullyParsedFiles.push(file);
        symbolSpool ??= this.factStore().spool();
        const symbols = toFactArray(symbolSpool, table.symbols);
        const summary = summarizeTable(table);
        symbolTables.push(summary);
        fullSymbols.set(summary, symbols);
        dispositions.set(file.id, { fileId: file.id, path: file.path, kind: "analyzed", symbolCount: table.symbols.length });
        records.push(
          createOwnedStorageRecord("symbol-table", {
            fileId: file.id,
            path: file.path,
            projectId: discovery.projectId,
            analysisRunId: command.id,
            symbolCount: table.symbols.length,
            classes: table.summary.classes,
            functions: table.summary.functions,
            imports: table.summary.imports,
            exports: table.summary.exports,
            symbols,
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

      symbolSpool?.close();
      const tsConfig = await loadTsConfigResolution(discovery.projectPath);
      this.tsConfigDiagnostics = tsConfig.diagnostics;
      // One resolver for the run: tsconfig aliases and workspace packages (S3) mean the same everywhere.
      const resolver = new ModuleResolver({ ...tsConfig.options, packages: await loadWorkspacePackages(discovery.projectPath, discovery.files) });
      const dependencyGraph = new DeterministicDependencyGraphBuilder(resolver).build(symbolTables, discovery.files, fullTables());
      records.push(
        createOwnedStorageRecord("dependency-graph", {
          projectId: discovery.projectId,
          analysisRunId: command.id,
          nodes: dependencyGraph.nodes,
          edges: dependencyGraph.edges,
          cycles: dependencyGraph.cycles,
          moduleGraph: dependencyGraph.moduleGraph,
        }),
      );
      const tablesByPath = new Map(symbolTables.map((table) => [canonicalizePath(table.filePath), table]));
      const symbolsByPath = new Map(symbolTables.map((table) => [canonicalizePath(table.filePath), table.symbols]));
      const importsByFile = new Map(symbolTables.map((table) => [canonicalizePath(table.filePath), table.symbols.filter((symbol) => symbol.kind === "import")]));
      const targetByImportId = new Map(dependencyGraph.edges.map((edge) => [edge.importSymbolId, edge.targetExportSymbolId]));

      const callGraphBuilder = new DeterministicCallGraphBuilder(resolver);
      const controlFlowBuilder = new DeterministicControlFlowGraphBuilder();
      const dataFlowBuilder = new DeterministicDataFlowGraphBuilder();

      let allHttpCalls: { readonly routes: readonly ExpressRoute[]; readonly middlewareChains: readonly MiddlewareChain[] }[] | undefined = [];
      // Whole-run fact lists are written to disk as they are made (ADR-009); records hold only their handles.
      const facts = this.factStore();
      const controlFlowGraphs = facts.writer<ControlFlowGraph>();
      // Calls and references go to disk file by file, in their final order; synthesis needs only their usage.
      const calls = new SortedFactList(facts, callSchema);
      const references = new SortedFactList(facts, referenceSchema);
      const usage = new FactUsage();
      // Each file's data-flow graph waits on disk; only what connecting needs stays (ADR-009 step 4a).
      const builtDataFlowGraphs = facts.writer<DataFlowGraphBody>();
      let allContexts: ConnectionContext[] | undefined = [];

      const sortedFiles = [...successfullyParsedFiles].sort((left, right) => compareCodePoints(left.path, right.path));
      const completedFiles: FileArtifact[] = [];

      for (const file of sortedFiles) {
        let ast: ASTResult | undefined;
        try {
          ast = await astStore.read(file.path);
        } catch (error: unknown) {
          recordSecondPassFailure(dispositions, file.id, getErrorCode(error, "PARSER_FAILURE"));
          events.push(createDomainEvent({
            type: "ParserFailure",
            aggregateId: discovery.projectId,
            payload: { fileId: file.id, path: file.path, code: getErrorCode(error, "PARSER_FAILURE") },
          }));
          continue;
        }

        if (ast.errors.length > 0) {
          recordSecondPassFailure(dispositions, file.id, ast.errors[0]?.code ?? "PARSER_FAILURE");
          events.push(createDomainEvent({
            type: "ParserFailure",
            aggregateId: discovery.projectId,
            payload: { fileId: file.id, path: file.path, code: ast.errors[0]?.code ?? "PARSER_FAILURE" },
          }));
          continue;
        }

        completedFiles.push(file);
        // This file's own table in full, for this file only; other files keep their summaries.
        const ownPath = canonicalizePath(file.path);
        const ownSummary = tablesByPath.get(ownPath);
        if (ownSummary !== undefined) {
          const own = fullTable(ownSummary);
          tablesByPath.set(ownPath, own);
          symbolsByPath.set(ownPath, own.symbols);
        }

        const fileCalls: SemanticCall[] = [];
        const fileReferences: SymbolReference[] = [];
        callGraphBuilder.buildForFile(ast, tablesByPath, importsByFile, targetByImportId, unstableExportIds, fileCalls, fileReferences);
        usage.add(fileCalls, fileReferences);
        calls.appendFile(fileCalls);
        references.appendFile(fileReferences);

        const httpCalls = findHttpCalls(
          ast.root,
          file.path,
          tablesByPath.get(canonicalizePath(file.path)),
        );
        allHttpCalls.push(httpCalls);

        const owners = (tablesByPath.get(canonicalizePath(file.path))?.symbols ?? []).filter((symbol) => symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "class");
        const controlFlow = controlFlowBuilder.buildAllWithNodes(ast, owners);
        for (const graph of controlFlow.graphs) controlFlowGraphs.append(graph);

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
          controlFlow,
        );
        const { functionSummaries, callBindings, interproceduralFlows, ...body } = contextResult.graph;
        builtDataFlowGraphs.append(body);
        const { filePath } = body;
        allContexts.push({ graph: { filePath, functionSummaries, callBindings, interproceduralFlows }, state: contextResult.state });

        if (ownSummary !== undefined) {
          tablesByPath.set(ownPath, ownSummary);
          symbolsByPath.set(ownPath, ownSummary.symbols);
        }
        ast = undefined;
      }

      const semanticEngine = new DeterministicSemanticAnalysisEngine(callGraphBuilder);
      let semantic: Omit<SemanticAnalysis, "calls" | "references"> | undefined = semanticEngine.synthesizeFromUsage({
        usage,
        symbolTables,
        fullTables,
        dependencyGraph,
        filePaths: completedFiles.map((file) => file.path),
        httpCalls: allHttpCalls,
        publicModules: await findPackageEntryFiles(discovery.projectPath, discovery.files),
      });
      allHttpCalls = undefined;

      records.push(
        createOwnedStorageRecord("semantic-analysis", {
          projectId: discovery.projectId,
          analysisRunId: command.id,
          calls: calls.seal(),
          references: references.seal(),
          scopes: toFactArray(facts, semantic.scopes),
          deadCode: semantic.deadCode,
          unusedImports: semantic.unusedImports,
          unusedExports: semantic.unusedExports,
          entryPoints: semantic.entryPoints,
          routes: semantic.routes,
          middlewareChains: semantic.middlewareChains,
        }),
      );
      semantic = undefined;

      const flowEngine = new DeterministicFlowAnalysisEngine(controlFlowBuilder, dataFlowBuilder);
      const dataFlowGraphs = facts.writer<unknown>();
      flowEngine.connectDataFlow(allContexts, builtDataFlowGraphs.seal(), fullTables(), (graph) => dataFlowGraphs.append({
        ...graph,
        callBindings: graph.callBindings.map((binding) => ({
          callId: binding.callId,
          targetSymbolId: binding.targetSymbolId,
          argumentDefinitionIds: binding.argumentDefinitionIds.map((definitionId) => definitionId ?? null),
          ...(binding.receiverDefinitionId === undefined ? {} : { receiverDefinitionId: binding.receiverDefinitionId }),
          ...(binding.argumentSourceIds === undefined ? {} : { argumentSourceIds: binding.argumentSourceIds.map((sourceId) => sourceId ?? null) }),
        })),
      }));
      allContexts = undefined;

      records.push(
        createOwnedStorageRecord("control-flow-analysis", {
          projectId: discovery.projectId,
          analysisRunId: command.id,
          graphs: controlFlowGraphs.seal(),
        }),
      );
      records.push(
        createOwnedStorageRecord("data-flow-analysis", {
          projectId: discovery.projectId,
          analysisRunId: command.id,
          graphs: dataFlowGraphs.seal(),
        }),
      );
      const knowledgeGraph = new DeterministicKnowledgeGraphBuilder().build(fullTables(), dependencyGraph);
      records.push(
        createOwnedStorageRecord("knowledge-graph", {
          projectId: discovery.projectId,
          analysisRunId: command.id,
          nodes: knowledgeGraph.nodes,
          edges: knowledgeGraph.edges,
        }),
      );

      const durationMs = performance.now() - startedAt;
      const analysisDisposition = createAnalysisDisposition([...dispositions.values()]);
      const analysisSummary = createAnalysisSummary({
        ...deriveR01Accounting(analysisDisposition, discovery.files, enumerationFailures.length, discovery.manifestFailures.length),
        durationMs,
      });

      records.push(
        createStorageRecord("analysis-run", {
          projectId: discovery.projectId,
          analysisRunId: command.id,
          status: "completed",
          analysisDisposition,
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
            secondPassFailures: analysisSummary.secondPassFailures,
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

/**
 * What other files read of a table (ADR-009 step 2): its imports, exports and exported declarations, with all of
 * its module references. Import resolution, namespace calls, re-export chains and export findings read no more.
 */
function summarizeTable(table: SymbolTable): SymbolTable {
  return { ...table, symbols: table.symbols.filter((symbol) => symbol.kind === "import" || symbol.kind === "export" || symbol.exported) };
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

function recordSecondPassFailure(dispositions: Map<string, AnalysisFileDisposition>, fileId: string, code: string): void {
  const disposition = dispositions.get(fileId);
  if (disposition?.kind !== "analyzed") throw new Error("Second-pass failure requires a successful table.");
  dispositions.set(fileId, { ...disposition, secondPassFailure: { code } });
}
