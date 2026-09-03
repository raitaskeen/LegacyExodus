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

const runtimeConfigSchema = z
  .object({
    environment: z.enum(["development", "test", "production"]),
    logLevel: z.string().trim().min(1),
    storageDriver: z.enum(["memory", "sqlite"]).default("memory"),
    storageDatabasePath: z.string().optional(),
  })
  .refine(
    (data) =>
      !(
        data.storageDriver === "memory" &&
        data.storageDatabasePath !== undefined &&
        data.storageDatabasePath.trim().length > 0
      ),
    {
      message: "Storage database path cannot be specified when using the memory storage driver.",
      path: ["storageDatabasePath"],
    },
  );

export function loadRuntimeConfig(environment: EnvironmentVariables = process.env): RuntimeConfig {
  const rawDriver = environment.LEGACY_EXODUS_STORAGE_DRIVER;
  const rawPath = environment.LEGACY_EXODUS_STORAGE_DB_PATH;

  const storageDriver =
    rawDriver ?? (rawPath && rawPath.trim().length > 0 ? "sqlite" : "memory");

  const parsedConfig = runtimeConfigSchema.safeParse({
    environment: environment.NODE_ENV ?? "development",
    logLevel: environment.LOG_LEVEL ?? "info",
    storageDriver,
    storageDatabasePath: rawPath,
  });

  if (!parsedConfig.success) {
    throw new ConfigurationError("Runtime configuration is invalid.", {
      issues: parsedConfig.error.issues,
    });
  }

  return parsedConfig.data;
}
