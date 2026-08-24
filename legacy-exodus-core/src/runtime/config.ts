import { z } from "zod";

import { ConfigurationError } from "@shared/errors";

export type RuntimeEnvironment = "development" | "test" | "production";
export type StorageDriver = "memory" | "sqlite";

export interface RuntimeConfig {
  readonly environment: RuntimeEnvironment;
  readonly logLevel: string;
  readonly storageDriver: StorageDriver;
  readonly storageDatabasePath?: string;
}

export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

const runtimeConfigSchema = z.object({
  environment: z.enum(["development", "test", "production"]),
  logLevel: z.string().trim().min(1),
  storageDriver: z.enum(["memory", "sqlite"]).default("memory"),
  storageDatabasePath: z.string().optional(),
});

export function loadRuntimeConfig(environment: EnvironmentVariables = process.env): RuntimeConfig {
  const parsedConfig = runtimeConfigSchema.safeParse({
    environment: environment.NODE_ENV ?? "development",
    logLevel: environment.LOG_LEVEL ?? "info",
    storageDriver: environment.LEGACY_EXODUS_STORAGE_DRIVER ?? "memory",
    storageDatabasePath: environment.LEGACY_EXODUS_STORAGE_DB_PATH,
  });

  if (!parsedConfig.success) {
    throw new ConfigurationError("Runtime configuration is invalid.", {
      issues: parsedConfig.error.issues,
    });
  }

  return parsedConfig.data;
}
