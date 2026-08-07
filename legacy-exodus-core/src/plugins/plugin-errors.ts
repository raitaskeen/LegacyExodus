import { LegacyExodusError, type ErrorMetadata } from "@shared/errors";

export class PluginAlreadyRegisteredError extends LegacyExodusError {
  public constructor(id: string) {
    super({
      code: "PLUGIN_ALREADY_REGISTERED",
      message: "A plugin with this identifier is already registered.",
      metadata: { id },
    });

    this.name = "PluginAlreadyRegisteredError";
  }
}

export class PluginNotFoundError extends LegacyExodusError {
  public constructor(id: string) {
    super({
      code: "PLUGIN_NOT_FOUND",
      message: "The requested plugin is not registered.",
      metadata: { id },
    });

    this.name = "PluginNotFoundError";
  }
}

export class PluginInitializationError extends LegacyExodusError {
  public constructor(id: string, cause: unknown) {
    super({
      code: "PLUGIN_INITIALIZATION_FAILED",
      message: "Plugin initialization failed.",
      metadata: { id },
      cause,
    });

    this.name = "PluginInitializationError";
  }
}

export class InvalidPluginManifestError extends LegacyExodusError {
  public constructor(metadata: ErrorMetadata) {
    super({
      code: "PLUGIN_MANIFEST_INVALID",
      message: "Plugin manifest is invalid.",
      metadata,
    });

    this.name = "InvalidPluginManifestError";
  }
}
