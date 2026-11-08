import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";

import type {
  DependencyArtifact,
  DiscoveryManifestFailure,
  FileArtifact,
  FrameworkArtifact,
} from "@contracts/discovery";
import { findWorkspaceRoots } from "@graph/workspace-loader";
import { compareCodePoints } from "@shared/ordering";
import { immutable } from "@shared/immutability";

interface ProjectManifest {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

const projectManifestSchema = z.object({
  name: z.string().trim().min(1).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
}).passthrough();

// UPGRADE: Expanded enterprise framework signatures
const frameworkSignatures = immutable([
  { framework: "express", dependencies: ["express"] },
  { framework: "mongodb", dependencies: ["mongodb", "mongoose"] },
  { framework: "react", dependencies: ["react", "react-dom"] },
  { framework: "nestjs", dependencies: ["@nestjs/core", "@nestjs/common"] },
  { framework: "postgresql", dependencies: ["pg", "postgres"] },
  { framework: "vue", dependencies: ["vue"] },
  { framework: "angular", dependencies: ["@angular/core"] }
]);

export interface ProjectDetection {
  readonly dependencies: readonly DependencyArtifact[];
  readonly frameworks: readonly FrameworkArtifact[];
  readonly languages: readonly string[];
  readonly manifestFailures: readonly DiscoveryManifestFailure[];
  readonly projectName: string;
}

export interface ProjectDetectorOptions {
  readonly readFile?: (path: string, encoding: "utf8") => Promise<string>;
}

type ManifestResult =
  | { readonly status: "absent" }
  | { readonly status: "valid"; readonly manifest: ProjectManifest }
  | { readonly status: "failure"; readonly failure: DiscoveryManifestFailure };

export class ProjectDetector {
  private readonly readFileFn: (path: string, encoding: "utf8") => Promise<string>;

  public constructor(options: ProjectDetectorOptions = {}) {
    this.readFileFn = options.readFile ?? readFile;
  }

  public async detect(
    projectPath: string,
    files: readonly FileArtifact[],
  ): Promise<ProjectDetection> {
    const result = await this.readManifest(projectPath, files);
    const manifest = result.status === "valid" ? result.manifest : null;
    const workspaces = await this.readWorkspaceManifests(projectPath, files);
    const dependencies = [
      ...this.detectDependencies(manifest, undefined),
      ...workspaces.flatMap((workspace) => this.detectDependencies(workspace.manifest, workspace.path)),
    ].sort((left, right) => compareCodePoints(left.name, right.name) || compareCodePoints(left.manifest ?? "", right.manifest ?? ""));
    const frameworks = this.detectFrameworks(dependencies);
    const languages = [...new Set(files.map((file) => file.language).filter((language) => language !== "unknown"))]
      .sort();
    const manifestFailures = result.status === "failure"
      ? [immutable(result.failure)]
      : [];

    return immutable({
      projectName: manifest?.name?.trim() || basename(projectPath),
      dependencies: immutable(dependencies),
      frameworks: immutable(frameworks),
      languages: immutable(languages),
      manifestFailures: immutable(manifestFailures),
    });
  }

  private async readManifest(
    projectPath: string,
    files: readonly FileArtifact[],
  ): Promise<ManifestResult> {
    // UPGRADE: OS-Agnostic path matching
    const hasPackageJson = files.some((file) => file.path === "package.json");

    if (!hasPackageJson) {
      return immutable({ status: "absent" });
    }

    let fileContent: string;
    try {
      fileContent = await this.readFileFn(join(projectPath, "package.json"), "utf8");
    } catch (error: unknown) {
      const code = getErrorCode(error);
      return code === "ENOENT"
        ? immutable({ status: "absent" })
        : createManifestFailure("manifest-read", code);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(fileContent);
    } catch (error: unknown) {
      return createManifestFailure(
        "manifest-parse",
        error instanceof SyntaxError ? "INVALID_JSON" : "JSON_PARSE_FAILURE",
      );
    }

    const parsedManifest = projectManifestSchema.safeParse(parsedJson);
    return parsedManifest.success
      ? immutable({ status: "valid", manifest: immutable(parsedManifest.data) })
      : createManifestFailure("manifest-validation", "SCHEMA_INVALID");
  }

  /**
   * Manifests of the workspace packages (S3's workspace rules), so a monorepo's dependencies and
   * frameworks are its packages' too. An unreadable or invalid one is skipped.
   */
  private async readWorkspaceManifests(projectPath: string, files: readonly FileArtifact[]): Promise<readonly { readonly path: string; readonly manifest: ProjectManifest }[]> {
    const manifests: { path: string; manifest: ProjectManifest }[] = [];
    for (const root of await findWorkspaceRoots(projectPath, files)) {
      const path = `${root}/package.json`;
      try {
        const parsed = projectManifestSchema.safeParse(JSON.parse(await this.readFileFn(join(projectPath, path), "utf8")));
        if (parsed.success) manifests.push({ path, manifest: parsed.data });
      } catch {
        // Not readable or not JSON: it contributes nothing.
      }
    }
    return manifests;
  }

  private detectDependencies(manifest: ProjectManifest | null, path: string | undefined): DependencyArtifact[] {
    const source = path === undefined ? {} : { manifest: path };
    const dependencies = Object.entries(manifest?.dependencies ?? {}).map(([name, version]) => ({
      name,
      version,
      kind: "production" as const,
      ...source,
    }));
    const developmentDependencies = Object.entries(manifest?.devDependencies ?? {}).map(([name, version]) => ({
      name,
      version,
      kind: "development" as const,
      ...source,
    }));

    return [...dependencies, ...developmentDependencies]
      .sort((left, right) => compareCodePoints(left.name, right.name))
      .map((dependency) => immutable(dependency));
  }

  /**
   * Frameworks a manifest declares (BA-15). Directory names (`controllers`, `components`) are not
   * evidence: a Rails app has controllers and a Vue app has components.
   */
  private detectFrameworks(dependencies: readonly DependencyArtifact[]): FrameworkArtifact[] {
    const rootNames = new Set(dependencies.filter((dependency) => dependency.manifest === undefined).map((dependency) => dependency.name));
    const workspaceNames = new Set(dependencies.filter((dependency) => dependency.manifest !== undefined).map((dependency) => dependency.name));
    const frameworks: FrameworkArtifact[] = [];

    for (const signature of frameworkSignatures) {
      const inRoot = signature.dependencies.some((dependency) => rootNames.has(dependency));
      const inWorkspace = signature.dependencies.some((dependency) => workspaceNames.has(dependency));
      this.addFramework(frameworks, signature.framework, inRoot || inWorkspace, inRoot ? "package.json dependency" : "workspace package.json dependency");
    }

    return frameworks.sort((left, right) => compareCodePoints(left.name, right.name));
  }

  private addFramework(
    frameworks: FrameworkArtifact[],
    name: string,
    detected: boolean,
    evidence: string,
  ): void {
    if (detected && !frameworks.some((framework) => framework.name === name)) {
      frameworks.push(immutable({ name, evidence }));
    }
  }
}

function createManifestFailure(
  kind: DiscoveryManifestFailure["kind"],
  code: string,
): ManifestResult {
  return immutable({
    status: "failure",
    failure: immutable({ path: "package.json", kind, code }),
  });
}

function getErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }
  return "MANIFEST_READ_FAILURE";
}
