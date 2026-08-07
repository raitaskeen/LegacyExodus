export type ErrorMetadata = Readonly<Record<string, unknown>>;

export interface LegacyExodusErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly metadata?: ErrorMetadata;
  readonly cause?: unknown;
}

export class LegacyExodusError extends Error {
  public readonly code: string;
  public readonly metadata: ErrorMetadata;

  public constructor(options: LegacyExodusErrorOptions) {
    super(options.message, { cause: options.cause });

    this.name = "LegacyExodusError";
    this.code = options.code;
    this.metadata = options.metadata ?? {};
  }
}

export class ConfigurationError extends LegacyExodusError {
  public constructor(message: string, metadata: ErrorMetadata = {}) {
    super({
      code: "RUNTIME_CONFIGURATION_INVALID",
      message,
      metadata,
    });

    this.name = "ConfigurationError";
  }
}
