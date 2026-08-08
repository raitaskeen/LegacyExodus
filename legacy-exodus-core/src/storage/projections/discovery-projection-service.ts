import { z } from "zod";

import {
  createDiscoveryProjection,
  type DiscoveryProjection,
} from "@contracts/discovery-projection";
import { LegacyExodusError } from "@shared/errors";
import type { StorageManager } from "@storage/storage-manager";

import { FileDiscoveryProjectionAdapter } from "./file-discovery-projection";

const discoveryStoragePayloadSchema = z.object({
  projectId: z.string().uuid(),
  projectName: z.string().min(1),
  projectPath: z.string().min(1),
  files: z.array(
    z.object({
      id: z.string().min(1),
      path: z.string().min(1),
      language: z.string().min(1),
      size: z.number().nonnegative(),
    }),
  ),
  dependencies: z.array(
    z.object({
      name: z.string().min(1),
      version: z.string().min(1),
      kind: z.enum(["production", "development"]),
    }),
  ),
  frameworks: z.array(
    z.object({
      name: z.string().min(1),
      evidence: z.string().min(1),
    }),
  ),
  languages: z.array(z.string().min(1)),
  discoveredAt: z.string().datetime(),
});

export class DiscoveryProjectionService {
  public constructor(
    private readonly storage: StorageManager,
    private readonly adapter: FileDiscoveryProjectionAdapter,
  ) {}

  public async project(recordId: string): Promise<DiscoveryProjection> {
    const record = await this.storage.findById(recordId);

    if (record === null || record.type !== "project-discovery") {
      throw new LegacyExodusError({
        code: "DISCOVERY_RECORD_NOT_FOUND",
        message: "Stored discovery record was not found.",
        metadata: { recordId },
      });
    }

    const parsedPayload = discoveryStoragePayloadSchema.safeParse(record.payload);

    if (!parsedPayload.success) {
      throw new LegacyExodusError({
        code: "DISCOVERY_RECORD_INVALID",
        message: "Stored discovery record is invalid.",
        metadata: { issues: parsedPayload.error.issues, recordId },
      });
    }

    const payload = parsedPayload.data;
    const projection = createDiscoveryProjection({
      projectPath: payload.projectPath,
      artifacts: [
        {
          name: "project.json",
          payload: {
            name: payload.projectName,
            path: payload.projectPath,
            languages: payload.languages,
          },
        },
        { name: "files.json", payload: payload.files },
        { name: "dependencies.json", payload: payload.dependencies },
        { name: "frameworks.json", payload: payload.frameworks },
        {
          name: "summary.json",
          payload: {
            projectName: payload.projectName,
            fileCount: payload.files.length,
            dependencyCount: payload.dependencies.length,
            frameworkCount: payload.frameworks.length,
            languages: payload.languages,
          },
        },
      ],
    });

    await this.adapter.write(projection);

    return projection;
  }
}
