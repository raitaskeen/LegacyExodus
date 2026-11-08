import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

function getRepoRoot(): string {
  let dir = __dirname;
  while (dir && !existsSync(join(dir, ".github"))) {
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

const REPO_ROOT = getRepoRoot();

describe("Repository Governance & GitHub Automation Hardening", () => {
  it("1. PR template exists and enforces all mandatory governance sections", () => {
    const prTemplateUpper = join(REPO_ROOT, ".github/PULL_REQUEST_TEMPLATE.md");
    const prTemplateLower = join(REPO_ROOT, ".github/pull_request_template.md");
    const prTemplatePath = existsSync(prTemplateUpper) ? prTemplateUpper : prTemplateLower;
    expect(existsSync(prTemplatePath)).toBe(true);

    const content = readFileSync(prTemplatePath, "utf-8");
    expect(content.length).toBeGreaterThan(100);

    const requiredSections = [
      "## Summary",
      "## Finding / Objective",
      "## Scope",
      "## What Changed",
      "## Regression & Test Coverage",
      "## Benchmark & Performance Impact",
      "## Security Impact",
      "## Documentation Impact",
      "## Breaking Changes",
      "## Related Issue",
      "## PR Checklist",
    ];

    for (const section of requiredSections) {
      expect(content).toContain(section);
    }
  });

  it("2. all GitHub Actions workflows define explicit least-privilege permissions and quality gates", () => {
    const workflowsDir = join(REPO_ROOT, ".github/workflows");
    expect(existsSync(workflowsDir)).toBe(true);

    const workflowFiles = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

    const expectedWorkflows = [
      "ci.yml",
      "documentation.yml",
      "labeler.yml",
    ];

    expect(workflowFiles.length).toBeGreaterThanOrEqual(expectedWorkflows.length);

    for (const expected of expectedWorkflows) {
      expect(workflowFiles).toContain(expected);
    }

    // Every workflow must declare explicit top-level permissions.
    for (const workflow of workflowFiles) {
      const filePath = join(workflowsDir, workflow);
      const content = readFileSync(filePath, "utf-8");
      expect(content.length).toBeGreaterThan(0);
      expect(content).toMatch(/^permissions:\s*$/m);
    }

    // 1. CI Workflow permission & quality gates
    const ciContent = readFileSync(join(workflowsDir, "ci.yml"), "utf-8");
    expect(ciContent).toContain("contents: read");
    expect(ciContent).not.toContain("contents: write");
    expect(ciContent).toContain("bun-version: 1.4.2");
    expect(ciContent).toContain("bun install --frozen-lockfile");
    expect(ciContent).toContain("bun run typecheck");
    expect(ciContent).toContain("bun test");
    expect(ciContent).toContain("bun run benchmark audit");
    expect(ciContent).toContain("git diff --check");

    // 2. Documentation Workflow permissions
    const docContent = readFileSync(join(workflowsDir, "documentation.yml"), "utf-8");
    expect(docContent).toContain("contents: read");
    expect(docContent).not.toContain("contents: write");

    // 3. Labeler Workflow permissions
    const labelerContent = readFileSync(join(workflowsDir, "labeler.yml"), "utf-8");
    expect(labelerContent).toContain("contents: read");
    expect(labelerContent).toContain("pull-requests: write");
    expect(labelerContent).not.toContain("contents: write");
  });

  it("3. issue templates have valid YAML frontmatter and required fields", () => {
    const issueTemplatesDir = join(REPO_ROOT, ".github/ISSUE_TEMPLATE");
    expect(existsSync(issueTemplatesDir)).toBe(true);

    const templateFiles = readdirSync(issueTemplatesDir).filter((f) => f.endsWith(".md"));
    expect(templateFiles.length).toBeGreaterThanOrEqual(3);

    const requiredTemplates = [
      "audit_finding.md",
      "bug_report.md",
      "feature_request.md",
      "architecture_proposal.md",
    ];

    for (const req of requiredTemplates) {
      expect(templateFiles).toContain(req);
    }

    for (const file of templateFiles) {
      const filePath = join(issueTemplatesDir, file);
      const content = readFileSync(filePath, "utf-8");
      expect(content.length).toBeGreaterThan(0);

      // Verify frontmatter syntax
      expect(content.startsWith("---")).toBe(true);
      const parts = content.split("---");
      expect(parts.length).toBeGreaterThanOrEqual(3);

      const frontmatter = parts[1]!;
      expect(frontmatter).toMatch(/name:\s*.+/);
      expect(frontmatter).toMatch(/about:\s*.+/);
    }
  });

  it("4. dependabot.yml exists, configures native bun and actions ecosystems, and protects against breaking compiler upgrades", () => {
    const dependabotPath = join(REPO_ROOT, ".github/dependabot.yml");
    expect(existsSync(dependabotPath)).toBe(true);

    const content = readFileSync(dependabotPath, "utf-8");
    expect(content).toContain("version: 2");
    expect(content).toContain('package-ecosystem: "bun"');
    expect(content).toContain('package-ecosystem: "github-actions"');
    expect(content).toContain('directory: "/legacy-exodus-core"');
    expect(content).toContain('dependency-name: "typescript"');
    expect(content).toContain('version-update:semver-major');
  });

  it("5. root governance and security documents exist and are populated", () => {
    const governanceDocs = [
      "SECURITY.md",
      "CONTRIBUTING.md",
      "GOVERNANCE.md",
      "CODE_OF_CONDUCT.md",
      "LICENSE",
      ".github/CODEOWNERS",
    ];

    for (const doc of governanceDocs) {
      const docPath = join(REPO_ROOT, doc);
      expect(existsSync(docPath)).toBe(true);
      const content = readFileSync(docPath, "utf-8");
      expect(content.trim().length).toBeGreaterThan(50);
    }
  });

  it("6. CI pins every action to a commit SHA and the fact-diff job is pull_request-only, least-privilege and fails on unexplained lost facts", () => {
    interface WorkflowStep {
      readonly name?: string;
      readonly uses?: string;
      readonly run?: string;
      readonly with?: Readonly<Record<string, unknown>>;
    }
    interface WorkflowJob {
      readonly name?: string;
      readonly if?: string;
      readonly "runs-on"?: string;
      readonly "timeout-minutes"?: number;
      readonly permissions?: unknown;
      readonly steps?: readonly WorkflowStep[];
    }
    const workflow = Bun.YAML.parse(readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf-8")) as {
      readonly permissions?: Readonly<Record<string, string>>;
      readonly jobs: Readonly<Record<string, WorkflowJob>>;
    };

    expect(workflow.permissions).toEqual({ contents: "read" });

    // Every third-party action in every CI job is pinned to a full commit SHA, and checkouts keep no credentials.
    for (const [jobId, job] of Object.entries(workflow.jobs)) {
      expect(typeof job["timeout-minutes"], `${jobId} must set timeout-minutes`).toBe("number");
      expect(job.permissions, `${jobId} must not widen the top-level permissions`).toBeUndefined();
      for (const step of job.steps ?? []) {
        if (step.uses === undefined) continue;
        expect(step.uses, `${jobId}: ${step.uses} must be pinned to a commit SHA`).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
        if (step.uses.startsWith("actions/checkout@")) {
          expect(step.with?.["persist-credentials"], `${jobId}: checkout must set persist-credentials: false`).toBe(false);
        }
      }
    }

    const factDiff = workflow.jobs["fact-diff"];
    expect(factDiff).toBeDefined();
    expect(factDiff?.name).toBe("Fact Diff");
    expect(factDiff?.["runs-on"]).toBe("ubuntu-latest");
    expect(factDiff?.if).toContain("github.event_name == 'pull_request'");

    const steps = factDiff?.steps ?? [];
    const checkouts = steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkouts.map((step) => step.with?.["path"])).toEqual(["head", "base"]);
    expect(checkouts[1]?.with?.["ref"]).toBe("${{ github.event.pull_request.base.sha }}");

    const commands = steps.map((step) => step.run ?? "");
    expect(commands.filter((command) => command.includes("bun install --frozen-lockfile")).length).toBe(2);
    const diff = commands.find((command) => command.includes("benchmarks/cli.ts fact-diff"));
    expect(diff).toBeDefined();
    expect(diff).toContain("--base ../../base/legacy-exodus-core");
    expect(diff).toContain("--head .");
    expect(diff).toContain("--output fact-diff.md");
    // The corpus comes from the base checkout so both engines analyze identical input.
    expect(diff).toContain("../../base/legacy-exodus-core/benchmarks/fixtures/governance-audit");
    expect(diff).toContain("../../base/legacy-exodus-core/src");
    // Real-world corpora at their pinned, tree-verified commits (NA-05).
    expect(diff).toContain("../../base/legacy-exodus-core/benchmarks/.cache/express");
    expect(diff).toContain("../../base/legacy-exodus-core/benchmarks/.cache/fastify");
    expect(commands.some((command) => command.includes("acquire.ts --name express") && command.includes("acquire.ts --name fastify"))).toBe(true);
    // Lost facts fail the job (NA-05) unless the owner labels the PR `facts-lost-explained`.
    expect(diff).toContain("contains(github.event.pull_request.labels.*.name, 'facts-lost-explained') && ' ' || '--fail-on-loss'");
    const pullRequest = (Bun.YAML.parse(readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf-8")) as { on: { pull_request: { types?: readonly string[] } } }).on.pull_request;
    expect(pullRequest.types).toEqual(["opened", "synchronize", "reopened", "labeled", "unlabeled"]);
    // The summary is published even when lost facts fail the diff step.
    const publish = steps.find((step) => step.run?.includes("fact-diff.md") && step.run.includes("$GITHUB_STEP_SUMMARY"));
    expect((publish as { if?: string } | undefined)?.if).toBe("always()");
  });
});
