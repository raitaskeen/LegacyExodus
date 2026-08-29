import { LegacyExodusEngine } from "@core/engine/engine";
import type { EngineContext } from "@core/engine/engine-context";
import { EventBus } from "@core/events/event-bus";
import { InMemoryEventStore } from "@core/events/event-store";
import { Orchestrator } from "@core/orchestration/orchestrator";
import { DiscoveryEngine } from "@discovery/index";
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

export function createEngineContext(
  environment: EnvironmentVariables = process.env,
): EngineContext {
  const config = loadRuntimeConfig(environment);
  const logger = createLogger(config, "runtime");
  const provider: StorageProvider =
    config.storageDriver === "sqlite"
      ? new SqliteStorageProvider({ databasePath: config.storageDatabasePath })
      : new MemoryStorageProvider();
  const storage = new StorageManager(provider);
  const discoveryProjection = new DiscoveryProjectionService(
    storage,
    new FileDiscoveryProjectionAdapter(),
  );
  const eventBus = new EventBus();
  const eventStore = new InMemoryEventStore();
  const plugins = new PluginRegistry();
  const parserRegistry = new ParserRegistry();
  parserRegistry.register(new JavaScriptParser());
  const parserManager = new ParserManager(parserRegistry);
  const pluginLoader = new PluginLoader(plugins, { logger, eventBus, storage });
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
): LegacyExodusEngine {
  return new LegacyExodusEngine(createEngineContext(environment));
}
