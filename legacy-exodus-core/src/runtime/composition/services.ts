import { LegacyExodusEngine } from "@core/engine/engine";
import type { EngineContext } from "@core/engine/engine-context";
import { EventBus } from "@core/events/event-bus";
import { InMemoryEventStore } from "@core/events/event-store";
import { Orchestrator } from "@core/orchestration/orchestrator";
import { createSnapshotTrust, defaultSnapshotKeyDirectory, DiscoveryEngine, DiscoveryValidator } from "@discovery/index";
import { PluginLoader, PluginRegistry } from "@plugins/index";
import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";
import { ApplicationRuntime } from "@runtime/application";
import { loadRuntimeConfig, type EnvironmentVariables } from "@runtime/config";
import { createLogger } from "@shared/logger";
import {
  DiscoveryProjectionService,
  FileDiscoveryProjectionAdapter,
  MemoryStorageProvider,
  SqliteStorageProvider,
  StorageManager,
  type StorageProvider,
} from "@storage/index";

export interface EngineCompositionOptions {
  /** Overrides the running analyzer identity used to authorize snapshot reuse. */
  readonly analyzerFingerprint?: () => Promise<string | undefined>;
}

export function createEngineContext(
  environment: EnvironmentVariables = process.env,
  options: EngineCompositionOptions = {},
): EngineContext {
  const config = loadRuntimeConfig(environment);
  const logger = createLogger(config, "runtime");
  const provider: StorageProvider =
    config.storageDriver === "sqlite"
      ? new SqliteStorageProvider({ databasePath: config.storageDatabasePath })
      : new MemoryStorageProvider();
  const storage = new StorageManager(provider);
  // One trust boundary signs projected snapshots and authorizes their reuse. The key
  // location is process-level user configuration unless this environment overrides it.
  const snapshotTrust = createSnapshotTrust({
    keyDirectory: defaultSnapshotKeyDirectory({ ...process.env, ...environment }),
    ...(options.analyzerFingerprint === undefined ? {} : { analyzerFingerprint: options.analyzerFingerprint }),
  });
  const discoveryProjection = new DiscoveryProjectionService(
    storage,
    new FileDiscoveryProjectionAdapter(undefined, snapshotTrust),
  );
  const eventBus = new EventBus();
  const eventStore = new InMemoryEventStore();
  const plugins = new PluginRegistry();
  const parserRegistry = new ParserRegistry();
  parserRegistry.register(new JavaScriptParser());
  const parserManager = new ParserManager(parserRegistry);
  const pluginLoader = new PluginLoader(plugins);
  const runtime = new ApplicationRuntime(config, logger, storage, plugins, pluginLoader);
  runtime.registerService(discoveryProjection);
  const orchestrator = new Orchestrator(
    eventStore,
    eventBus,
    storage,
    new DiscoveryEngine(),
    undefined,
    parserManager,
    new JavaScriptSymbolExtractor(),
    (failure) => {
      logger.error(
        {
          aggregateId: failure.aggregateId,
          ...(failure.error instanceof Error
            ? { err: failure.error }
            : { error: String(failure.error) }),
          eventId: failure.eventId,
          eventType: failure.eventType,
          stage: failure.stage,
        },
        "Post-commit event delivery failed",
      );
    },
    undefined,
    (failure) => {
      logger.error(
        {
          analysisRunId: failure.analysisRunId,
          ...(failure.error instanceof Error
            ? { err: failure.error }
            : { error: String(failure.error) }),
          projectId: failure.projectId,
          stage: failure.stage,
        },
        "Run-scoped AST cleanup failed",
      );
    },
    new DiscoveryValidator(snapshotTrust),
  );
  runtime.registerService(orchestrator);

  return {
    runtime,
    eventStore,
    eventBus,
    storage,
    discoveryProjection,
    plugins,
    parserRegistry,
    parserManager,
    orchestrator,
  };
}

export function createLegacyExodusEngine(
  environment: EnvironmentVariables = process.env,
  options: EngineCompositionOptions = {},
): LegacyExodusEngine {
  return new LegacyExodusEngine(createEngineContext(environment, options));
}
