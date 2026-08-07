import { PluginInitializationError } from "./plugin-errors";
import type { LegacyExodusPlugin } from "./plugin";
import type { PluginContext } from "./plugin-context";
import { validatePluginManifest } from "./plugin-manifest";
import type { PluginRegistry } from "./plugin-registry";

export class PluginLoader {
  public constructor(
    private readonly registry: PluginRegistry,
    private readonly context: PluginContext,
  ) {}

  public async load(plugin: LegacyExodusPlugin): Promise<void> {
    validatePluginManifest(plugin);
    this.registry.register(plugin);

    try {
      await plugin.initialize(this.context);
    } catch (error: unknown) {
      this.registry.unregister(plugin.id);
      throw new PluginInitializationError(plugin.id, error);
    }
  }
}
