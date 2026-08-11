import { PluginAlreadyRegisteredError, PluginNotFoundError } from "./plugin-errors";
import type { LegacyExodusPlugin } from "./plugin";

export class PluginRegistry {
  private readonly plugins = new Map<string, LegacyExodusPlugin>();

  public register(plugin: LegacyExodusPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new PluginAlreadyRegisteredError(plugin.id);
    }

    this.plugins.set(plugin.id, plugin);
  }

  public get(id: string): LegacyExodusPlugin {
    const plugin = this.plugins.get(id);

    if (plugin === undefined) {
      throw new PluginNotFoundError(id);
    }

    return plugin;
  }

  public has(id: string): boolean {
    return this.plugins.has(id);
  }

  public list(): readonly LegacyExodusPlugin[] {
    return [...this.plugins.values()];
  }

  public unregister(id: string): void {
    this.plugins.delete(id);
  }
}
