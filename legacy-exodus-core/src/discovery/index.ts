export { DiscoveryEngine } from "./discovery-engine";
export type { DiscoveryContext } from "./discovery-context";
export type { DiscoveryResult } from "./discovery-result";
export { DiscoveryQueryService, type ProjectDiscoveryPayload, type SymbolTablePayload } from "./discovery-query-service";
export {
  DiscoveryValidator,
  computeWorkspaceDigest,
  isPathWithinDirectory,
  type DiscoveryManifest,
  type DiscoveryValidationResult,
  type DiscoveryValidationStatus,
  type ValidateDiscoveryOptions,
} from "./discovery-validator";
export {
  computeManifestMac,
  discoveryManifestSchema,
  manifestKeyId,
  MANIFEST_MAC_ALGORITHM,
  verifyManifestMac,
} from "./discovery-manifest";
export { FileScanner } from "./file-scanner";
export {
  createSnapshotTrust,
  defaultSnapshotKeyDirectory,
  SNAPSHOT_KEY_FILE_NAME,
  SnapshotKeyStore,
  type SnapshotTrust,
  type SnapshotTrustOptions,
} from "./snapshot-trust";
export { ProjectDetector, type ProjectDetection } from "./project-detector";
