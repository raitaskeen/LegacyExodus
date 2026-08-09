import type {
  AnalyzeProjectCommand,
  DiscoverProjectCommand,
  InitializeProjectCommand,
  UpdateKnowledgeCommand,
} from "@contracts/commands";
import type {
  FileDiscovered,
  KnowledgeUpdated,
  ProjectInitialized,
} from "@contracts/events";
import { createDomainEvent, type DomainEvent } from "@core/events/domain-event";
import { DiscoveryEngine, type DiscoveryResult } from "@discovery/index";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ParserManager } from "@parser/index";
import { createStorageRecord, type StorageRecord } from "@storage/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

export interface CommandExecution {
  readonly events: readonly DomainEvent[];
  readonly records: readonly StorageRecord[];
  readonly discovery?: DiscoveryResult;
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
    const discovery = await this.discoveryEngine.discover({
      projectId: command.payload.projectId,
      projectPath: command.payload.path,
    });
    const record = createStorageRecord("project-discovery", {
      projectId: discovery.projectId,
      projectName: discovery.projectName,
      projectPath: discovery.projectPath,
      files: discovery.files.map((file) => ({ ...file })),
      dependencies: discovery.dependencies.map((dependency) => ({ ...dependency })),
      frameworks: discovery.frameworks.map((framework) => ({ ...framework })),
      languages: [...discovery.languages],
      discoveredAt: discovery.discoveredAt.toISOString(),
    });

    const events: DomainEvent[] = [...this.discoveryEngine.createEvents(discovery)];
    const records: StorageRecord[] = [record];

    for (const file of discovery.files) {
      if (file.language !== "javascript") {
        continue;
      }

      const ast = await this.parserManager.parse({
        file,
        source: await readFile(resolve(discovery.projectPath, file.path), "utf8"),
      });
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

      const table = this.symbolExtractor.extract(ast);
      records.push(
        createStorageRecord("symbol-table", {
          fileId: file.id,
          path: file.path,
          symbolCount: table.symbols.length,
          classes: table.summary.classes,
          functions: table.summary.functions,
          imports: table.summary.imports,
          exports: table.summary.exports,
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

    return { events: Object.freeze(events), records: Object.freeze(records), discovery };
  }
}
