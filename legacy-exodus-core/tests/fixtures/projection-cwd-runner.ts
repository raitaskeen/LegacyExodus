import { FileDiscoveryProjectionAdapter } from "@storage/index";
import { createDiscoveryProjection } from "@contracts/discovery-projection";

const projectPath = process.argv[2];
if (projectPath === undefined) {
  throw new Error("Expected a project path.");
}

await new FileDiscoveryProjectionAdapter().write(createDiscoveryProjection({
  projectPath,
  artifacts: [{ name: "summary.json", payload: { fileCount: 0 } }],
}));
