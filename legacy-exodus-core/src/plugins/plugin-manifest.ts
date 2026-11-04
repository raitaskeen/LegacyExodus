import { z } from "zod";

import { InvalidPluginManifestError } from "./plugin-errors";
import { immutable } from "@shared/immutability";

export type PluginType = "parser" | "storage" | "ai-provider" | "migration" | "validator";

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly type: PluginType;
}

const pluginManifestSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
  type: z.enum(["parser", "storage", "ai-provider", "migration", "validator"]),
});

export function validatePluginManifest(manifest: unknown): PluginManifest {
  const parsedManifest = pluginManifestSchema.safeParse(manifest);

  if (!parsedManifest.success) {
    throw new InvalidPluginManifestError({ issues: parsedManifest.error.issues });
  }

  return immutable(parsedManifest.data);
}
