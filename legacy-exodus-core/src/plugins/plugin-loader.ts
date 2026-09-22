import { PluginInitializationError } from "./plugin-errors";
import type { LegacyExodusPlugin } from "./plugin";
import type { PluginContext } from "./plugin-context";
import { validatePluginManifest } from "./plugin-manifest";
import type { PluginRegistry } from "./plugin-registry";

const pluginContext: PluginContext = Object.freeze({});

export class PluginLoader {
  public constructor(private readonly registry: PluginRegistry) {}

  public async load(plugin: LegacyExodusPlugin): Promise<void> {
    validatePluginManifest(plugin);
    this.registry.register(plugin);

    try {
      await plugin.initialize(pluginContext);
    } catch (error: unknown) {
      this.registry.unregister(plugin.id);
      throw new PluginInitializationError(plugin.id, error);
    }
  }
}
