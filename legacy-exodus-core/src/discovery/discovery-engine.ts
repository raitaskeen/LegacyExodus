import { createDomainEvent, type DomainEvent } from "@core/events/domain-event";

import {
  validateProjectDiscovery,
  type ProjectDiscovery,
} from "@contracts/discovery";
import type { DiscoveryContext } from "./discovery-context";
import type { DiscoveryResult } from "./discovery-result";
import { FileScanner } from "./file-scanner";
import { ProjectDetector } from "./project-detector";

export class DiscoveryEngine {
  public constructor(
    private readonly fileScanner: FileScanner = new FileScanner(),
    private readonly projectDetector: ProjectDetector = new ProjectDetector(),
  ) {}

  public async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const files = await this.fileScanner.scan(context.projectPath);
    const detection = await this.projectDetector.detect(context.projectPath, files);

    return validateProjectDiscovery({
      projectId: context.projectId,
      projectName: detection.projectName,
      projectPath: context.projectPath,
      files,
      dependencies: detection.dependencies,
      frameworks: detection.frameworks,
      languages: detection.languages,
      discoveredAt: new Date(),
    });
  }

  public createEvents(discovery: ProjectDiscovery): readonly DomainEvent[] {
    const fileEvents = discovery.files.map((file) =>
      createDomainEvent({
        type: "FileDiscovered",
        aggregateId: discovery.projectId,
        payload: { fileId: file.id, path: file.path, language: file.language },
      }),
    );
    const dependencyEvents = discovery.dependencies.map((dependency) =>
      createDomainEvent({
        type: "DependencyDetected",
        aggregateId: discovery.projectId,
        payload: { name: dependency.name, version: dependency.version },
      }),
    );
    const frameworkEvents = discovery.frameworks.map((framework) =>
      createDomainEvent({
        type: "FrameworkDetected",
        aggregateId: discovery.projectId,
        payload: { name: framework.name, evidence: framework.evidence },
      }),
    );
    const completionEvent = createDomainEvent({
      type: "DiscoveryCompleted",
      aggregateId: discovery.projectId,
      payload: {
        projectId: discovery.projectId,
        fileCount: discovery.files.length,
        dependencyCount: discovery.dependencies.length,
        frameworkCount: discovery.frameworks.length,
      },
    });

    return Object.freeze([...fileEvents, ...dependencyEvents, ...frameworkEvents, completionEvent]);
  }
}
