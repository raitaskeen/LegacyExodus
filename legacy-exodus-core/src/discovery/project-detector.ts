import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

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
    if (!files.some((file) => file.path === "package.json")) {
      return null;
    }

    try {
      return JSON.parse(await readFile(join(projectPath, "package.json"), "utf8")) as ProjectManifest;
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

    this.addFramework(frameworks, "express", dependencyNames.has("express"), "package.json dependency");
    this.addFramework(
      frameworks,
      "react",
      dependencyNames.has("react") || dependencyNames.has("react-dom"),
      "package.json dependency",
    );
    this.addFramework(
      frameworks,
      "mongodb",
      dependencyNames.has("mongodb") || dependencyNames.has("mongoose"),
      "package.json dependency",
    );
    this.addFramework(
      frameworks,
      "express",
      files.some((file) => file.path.startsWith("controllers/") || file.path.startsWith("routes/")),
      "controller or route directory pattern",
    );
    this.addFramework(
      frameworks,
      "react",
      files.some((file) => file.path.startsWith("components/") || file.path.startsWith("src/components/")),
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
