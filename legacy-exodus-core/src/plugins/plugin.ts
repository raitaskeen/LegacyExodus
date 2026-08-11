import type { PluginContext } from "./plugin-context";
import type { PluginManifest } from "./plugin-manifest";

export interface LegacyExodusPlugin extends PluginManifest {
  initialize(context: PluginContext): Promise<void>;
  shutdown(): Promise<void>;
}
