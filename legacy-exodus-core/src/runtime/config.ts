import { z } from "zod";

import { ConfigurationError } from "@shared/errors";

export type RuntimeEnvironment = "development" | "test" | "production";

export interface RuntimeConfig {
  readonly environment: RuntimeEnvironment;
  readonly logLevel: string;
}

export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

const runtimeConfigSchema = z.object({
  environment: z.enum(["development", "test", "production"]),
  logLevel: z.string().trim().min(1),
});

export function loadRuntimeConfig(environment: EnvironmentVariables = process.env): RuntimeConfig {
  const parsedConfig = runtimeConfigSchema.safeParse({
    environment: environment.NODE_ENV ?? "development",
    logLevel: environment.LOG_LEVEL ?? "info",
  });

  if (!parsedConfig.success) {
    throw new ConfigurationError("Runtime configuration is invalid.", {
      issues: parsedConfig.error.issues,
    });
  }

  return parsedConfig.data;
}
