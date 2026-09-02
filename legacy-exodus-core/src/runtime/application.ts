import type { Logger } from "pino";

import { LegacyExodusError } from "@shared/errors";
import type { PluginLoader, PluginRegistry } from "@plugins/index";
import type { StorageManager } from "@storage/index";

import type { RuntimeConfig } from "./config";

export type RuntimeStatus =
  | "created"
  | "starting"
  | "configured"
  | "storage-ready"
  | "plugin-system-ready"
  | "running"
  | "stopping"
  | "stopped";

export interface RuntimeService {
  readonly name: string;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}

export class ApplicationRuntime {
  private readonly services: RuntimeService[] = [];
  private readonly startedServices: RuntimeService[] = [];
  private status: RuntimeStatus = "created";
  private shutdownPromise?: Promise<void>;

  public constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
    private readonly storageManager: StorageManager,
    private readonly pluginRegistry: PluginRegistry,
    private readonly pluginLoader: PluginLoader,
  ) {}

  public registerService(service: RuntimeService): void {
    if (this.status !== "created") {
      throw new LegacyExodusError({
        code: "RUNTIME_SERVICE_REGISTRATION_CLOSED",
        message: "Services can only be registered before the runtime starts.",
        metadata: { status: this.status, service: service.name },
      });
    }

    if (this.services.some((existing) => existing.name === service.name)) {
      throw new LegacyExodusError({
        code: "RUNTIME_DUPLICATE_SERVICE",
        message: `A runtime service named "${service.name}" is already registered.`,
        metadata: { service: service.name },
      });
    }

    this.services.push(service);
  }

  public async start(): Promise<void> {
    if (this.status === "running") {
      return;
    }

    if (this.status !== "created") {
      throw new LegacyExodusError({
        code: "RUNTIME_START_INVALID_STATE",
        message: "The runtime cannot be started from its current state.",
        metadata: { status: this.status },
      });
    }

    this.status = "starting";
    this.startedServices.length = 0;

    try {
      for (const service of this.services) {
        await service.start?.();
        this.startedServices.push(service);
      }

      this.status = "running";
      this.logger.info("Application started");
    } catch (error: unknown) {
      this.status = "stopped";
      try {
        await this.performCleanup();
      } catch (cleanupError: unknown) {
        this.logger.error({ error: cleanupError }, "Cleanup failed after startup failure");
      }
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    if (this.status === "stopped") {
      return;
    }

    if (this.shutdownPromise !== undefined) {
      return this.shutdownPromise;
    }

    this.status = "stopping";
    this.shutdownPromise = (async () => {
      try {
        await this.performCleanup();
      } finally {
        this.status = "stopped";
        this.shutdownPromise = undefined;
        this.logger.info("Application stopped");
      }
    })();

    return this.shutdownPromise;
  }

  public getStatus(): RuntimeStatus {
    return this.status;
  }

  public getConfig(): RuntimeConfig {
    return this.config;
  }

  public getStorageManager(): StorageManager {
    return this.storageManager;
  }

  public getPluginRegistry(): PluginRegistry {
    return this.pluginRegistry;
  }

  public getPluginLoader(): PluginLoader {
    return this.pluginLoader;
  }

  private async performCleanup(): Promise<void> {
    const shutdownFailures: unknown[] = [];

    // 1. Stop all started services in reverse order
    for (const service of [...this.startedServices].reverse()) {
      try {
        await service.stop?.();
      } catch (error: unknown) {
        shutdownFailures.push(error);
        this.logger.error({ error, service: service.name }, "Service shutdown failed");
      }
    }
    this.startedServices.length = 0;

    // 2. Shut down all loaded plugins in reverse order and unregister
    const loadedPlugins = [...this.pluginRegistry.list()].reverse();
    for (const plugin of loadedPlugins) {
      try {
        await plugin.shutdown();
      } catch (error: unknown) {
        shutdownFailures.push(error);
        this.logger.error({ error, plugin: plugin.id }, "Plugin shutdown failed");
      } finally {
        this.pluginRegistry.unregister(plugin.id);
      }
    }

    // 3. Close storage manager (closes SQLite connections / clears in-memory storage)
    try {
      await this.storageManager.close();
    } catch (error: unknown) {
      shutdownFailures.push(error);
      this.logger.error({ error }, "Storage shutdown failed");
    }

    if (shutdownFailures.length > 0) {
      throw new LegacyExodusError({
        code: "RUNTIME_SHUTDOWN_FAILED",
        message: "One or more runtime services failed to stop.",
        metadata: { failureCount: shutdownFailures.length },
      });
    }
  }
}
