import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { DiscoveryProjection } from "@contracts/discovery-projection";

export class FileDiscoveryProjectionAdapter {
  public async write(projection: DiscoveryProjection): Promise<void> {
    const discoveryDirectory = join(resolve(projection.projectPath), ".discovery");

    await mkdir(discoveryDirectory, { recursive: true });

    for (const artifact of projection.artifacts) {
      const destination = join(discoveryDirectory, artifact.name);
      const temporaryDestination = `${destination}.tmp`;
      const content = `${JSON.stringify(artifact.payload, null, 2)}\n`;

      await writeFile(temporaryDestination, content, "utf8");
      await rename(temporaryDestination, destination);
    }
  }
}
