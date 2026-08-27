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
    expect(workflowFiles.length).toBeGreaterThanOrEqual(4);

    const expectedWorkflows = [
      "ci.yml",
      "documentation.yml",
      "security-scan.yml",
      "labeler.yml",
    ];

    for (const expected of expectedWorkflows) {
      expect(workflowFiles).toContain(expected);
      const filePath = join(workflowsDir, expected);
      const content = readFileSync(filePath, "utf-8");
      expect(content.length).toBeGreaterThan(0);

      // Verify top-level permissions block exists for least privilege
      expect(content).toMatch(/^permissions:\s*$/m);
    }

    // 1. CI Workflow permission & quality gates
    const ciContent = readFileSync(join(workflowsDir, "ci.yml"), "utf-8");
    expect(ciContent).toContain("contents: read");
    expect(ciContent).not.toContain("contents: write");
    expect(ciContent).toContain("bun run typecheck");
    expect(ciContent).toContain("bun test");
    expect(ciContent).toContain("bun run benchmark audit");
    expect(ciContent).toContain("git diff --check");

    // 2. Security Scan Workflow permissions
    const secContent = readFileSync(join(workflowsDir, "security-scan.yml"), "utf-8");
    expect(secContent).toContain("contents: read");
    expect(secContent).toContain("security-events: write");
    expect(secContent).not.toContain("contents: write");

    // 3. Documentation Workflow permissions
    const docContent = readFileSync(join(workflowsDir, "documentation.yml"), "utf-8");
    expect(docContent).toContain("contents: read");
    expect(docContent).not.toContain("contents: write");

    // 4. Labeler Workflow permissions
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

  it("4. dependabot.yml exists and configures npm and actions ecosystems", () => {
    const dependabotPath = join(REPO_ROOT, ".github/dependabot.yml");
    expect(existsSync(dependabotPath)).toBe(true);

    const content = readFileSync(dependabotPath, "utf-8");
    expect(content).toContain("version: 2");
    expect(content).toContain('package-ecosystem: "npm"');
    expect(content).toContain('package-ecosystem: "github-actions"');
    expect(content).toContain('directory: "/legacy-exodus-core"');
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
});
