import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";

import type {
  DependencyArtifact,
  FileArtifact,
  FrameworkArtifact,
} from "@contracts/discovery";

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
const frameworkSignatures = Object.freeze([
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
  readonly projectName: string;
}

export class ProjectDetector {
  public async detect(
    projectPath: string,
    files: readonly FileArtifact[],
  ): Promise<ProjectDetection> {
    const manifest = await this.readManifest(projectPath, files);
    const dependencies = this.detectDependencies(manifest);
    const frameworks = this.detectFrameworks(dependencies, files);
    const languages = [...new Set(files.map((file) => file.language).filter((language) => language !== "unknown"))]
      .sort();

    return Object.freeze({
      projectName: manifest?.name?.trim() || basename(projectPath),
      dependencies: Object.freeze(dependencies),
      frameworks: Object.freeze(frameworks),
      languages: Object.freeze(languages),
    });
  }

  private async readManifest(
    projectPath: string,
    files: readonly FileArtifact[],
  ): Promise<ProjectManifest | null> {
    // UPGRADE: OS-Agnostic path matching
    const hasPackageJson = files.some((file) => file.path === "package.json");

    if (!hasPackageJson) {
      return null;
    }

    try {
      const fileContent = await readFile(join(projectPath, "package.json"), "utf8");
      const parsedManifest = projectManifestSchema.safeParse(JSON.parse(fileContent));

      return parsedManifest.success ? parsedManifest.data : null;
    } catch {
      return null;
    }
  }

  private detectDependencies(manifest: ProjectManifest | null): DependencyArtifact[] {
    const dependencies = Object.entries(manifest?.dependencies ?? {}).map(([name, version]) => ({
      name,
      version,
      kind: "production" as const,
    }));
    const developmentDependencies = Object.entries(manifest?.devDependencies ?? {}).map(([name, version]) => ({
      name,
      version,
      kind: "development" as const,
    }));

    return [...dependencies, ...developmentDependencies]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((dependency) => Object.freeze(dependency));
  }

  private detectFrameworks(
    dependencies: readonly DependencyArtifact[],
    files: readonly FileArtifact[],
  ): FrameworkArtifact[] {
    const dependencyNames = new Set(dependencies.map((dependency) => dependency.name));
    const frameworks: FrameworkArtifact[] = [];

    for (const signature of frameworkSignatures) {
      this.addFramework(
        frameworks,
        signature.framework,
        signature.dependencies.some((dependency) => dependencyNames.has(dependency)),
        "package.json dependency",
      );
    }
    
    const hasDirectory = (directory: string): boolean => files.some((file) =>
      file.path.split(/[\\/]/).some((segment) => segment === directory),
    );

    this.addFramework(
      frameworks,
      "express",
      hasDirectory("controllers") || hasDirectory("routes"),
      "controller or route directory pattern",
    );
    this.addFramework(
      frameworks,
      "react",
      hasDirectory("components"),
      "component directory pattern",
    );

    return frameworks.sort((left, right) => left.name.localeCompare(right.name));
  }

  private addFramework(
    frameworks: FrameworkArtifact[],
    name: string,
    detected: boolean,
    evidence: string,
  ): void {
    if (detected && !frameworks.some((framework) => framework.name === name)) {
      frameworks.push(Object.freeze({ name, evidence }));
    }
  }
}
