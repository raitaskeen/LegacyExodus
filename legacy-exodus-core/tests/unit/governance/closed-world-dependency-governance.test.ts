import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { GroundTruthFact, GroundTruthDependency } from "@contracts/fidelity";
import { expressGroundTruth } from "../../../benchmarks/fidelity/express-ground-truth";
import { fastifyGroundTruth } from "../../../benchmarks/fidelity/fastify-ground-truth";

export interface DependencyManifestEntry {
  readonly name: string;
  readonly version: string;
  readonly kind: "production" | "development";
}

export interface DependencyReconciliationResult {
  readonly isValid: boolean;
  readonly missingFromGT: readonly DependencyManifestEntry[];
  readonly unexpectedInGT: readonly GroundTruthFact[];
  readonly versionMismatches: readonly {
    readonly name: string;
    readonly manifestVersion: string;
    readonly gtVersion: string;
  }[];
  readonly kindMismatches: readonly {
    readonly name: string;
    readonly manifestKind: string;
    readonly gtKind: string;
  }[];
  readonly duplicatesInGT: readonly string[];
  readonly violatedKnownNegatives: readonly GroundTruthFact[];
}

export function reconcileDependencyInventory(
  manifestContent: string,
  groundTruthFacts: readonly GroundTruthFact[],
): DependencyReconciliationResult {
  const parsed = JSON.parse(manifestContent);
  const prodDeps: Record<string, string> = parsed.dependencies ?? {};
  const devDeps: Record<string, string> = parsed.devDependencies ?? {};

  const expectedEntries: DependencyManifestEntry[] = [
    ...Object.entries(prodDeps).map(([name, version]) => ({
      name,
      version: String(version),
      kind: "production" as const,
    })),
    ...Object.entries(devDeps).map(([name, version]) => ({
      name,
      version: String(version),
      kind: "development" as const,
    })),
  ];

  const allManifestNames = new Set(expectedEntries.map((e) => e.name));

  const positiveGtDeps = groundTruthFacts.filter((f) => f.category === "dependency" && !f.isKnownNegative);
  const knownNegativeGtDeps = groundTruthFacts.filter((f) => f.category === "dependency" && f.isKnownNegative);

  const seenIds = new Set<string>();
  const duplicatesInGT: string[] = [];
  for (const dep of positiveGtDeps) {
    if (seenIds.has(dep.id)) {
      duplicatesInGT.push(dep.id);
    }
    seenIds.add(dep.id);
  }

  const missingFromGT: DependencyManifestEntry[] = [];
  const versionMismatches: { name: string; manifestVersion: string; gtVersion: string }[] = [];
  const kindMismatches: { name: string; manifestKind: string; gtKind: string }[] = [];

  const matchedGtIds = new Set<string>();

  for (const exp of expectedEntries) {
    const matchedFact = positiveGtDeps.find((f) => {
      const attr = f.attributes as unknown as GroundTruthDependency;
      return attr.name === exp.name;
    });

    if (!matchedFact) {
      missingFromGT.push(exp);
    } else {
      matchedGtIds.add(matchedFact.id);
      const attr = matchedFact.attributes as unknown as GroundTruthDependency;
      if (attr.kind && attr.kind !== exp.kind) {
        kindMismatches.push({
          name: exp.name,
          manifestKind: exp.kind,
          gtKind: String(attr.kind),
        });
      }
      if (attr.version && attr.version !== exp.version) {
        versionMismatches.push({
          name: exp.name,
          manifestVersion: exp.version,
          gtVersion: String(attr.version),
        });
      }
    }
  }

  const unexpectedInGT = positiveGtDeps.filter((f) => !matchedGtIds.has(f.id));

  // Check known negatives: ensure none of them exist in the manifest!
  const violatedKnownNegatives = knownNegativeGtDeps.filter((neg) => {
    const attr = neg.attributes as unknown as GroundTruthDependency;
    return allManifestNames.has(attr.name);
  });

  const isValid =
    missingFromGT.length === 0 &&
    unexpectedInGT.length === 0 &&
    versionMismatches.length === 0 &&
    kindMismatches.length === 0 &&
    duplicatesInGT.length === 0 &&
    violatedKnownNegatives.length === 0;

  return {
    isValid,
    missingFromGT,
    unexpectedInGT,
    versionMismatches,
    kindMismatches,
    duplicatesInGT,
    violatedKnownNegatives,
  };
}

describe("CLOSED-World Dependency Ground Truth Governance", () => {
  it("enforces exact 1:1 bijection for Express v4.21.2 dependency inventory", async () => {
    const pkgPath = resolve(import.meta.dir, "../../../benchmarks/.cache/express/package.json");
    const rawPkg = await readFile(pkgPath, "utf8");

    const result = reconcileDependencyInventory(rawPkg, expressGroundTruth);

    expect(result.missingFromGT).toEqual([]);
    expect(result.unexpectedInGT).toEqual([]);
    expect(result.versionMismatches).toEqual([]);
    expect(result.kindMismatches).toEqual([]);
    expect(result.duplicatesInGT).toEqual([]);
    expect(result.violatedKnownNegatives).toEqual([]);
    expect(result.isValid).toBe(true);

    const depFacts = expressGroundTruth.filter((f) => f.category === "dependency" && !f.isKnownNegative);
    expect(depFacts).toHaveLength(47);
    const prodCount = depFacts.filter((f) => (f.attributes as any).kind === "production").length;
    const devCount = depFacts.filter((f) => (f.attributes as any).kind === "development").length;
    expect(prodCount).toBe(31);
    expect(devCount).toBe(16);
  });

  it("enforces exact 1:1 bijection for Fastify v5.3.3 dependency inventory", async () => {
    const pkgPath = resolve(import.meta.dir, "../../../benchmarks/.cache/fastify/package.json");
    const rawPkg = await readFile(pkgPath, "utf8");

    const result = reconcileDependencyInventory(rawPkg, fastifyGroundTruth);

    expect(result.missingFromGT).toEqual([]);
    expect(result.unexpectedInGT).toEqual([]);
    expect(result.versionMismatches).toEqual([]);
    expect(result.kindMismatches).toEqual([]);
    expect(result.duplicatesInGT).toEqual([]);
    expect(result.violatedKnownNegatives).toEqual([]);
    expect(result.isValid).toBe(true);

    const depFacts = fastifyGroundTruth.filter((f) => f.category === "dependency" && !f.isKnownNegative);
    expect(depFacts).toHaveLength(53);
    const prodCount = depFacts.filter((f) => (f.attributes as any).kind === "production").length;
    const devCount = depFacts.filter((f) => (f.attributes as any).kind === "development").length;
    expect(prodCount).toBe(15);
    expect(devCount).toBe(38);
  });

  describe("Governance Self-Defense (Negative Mutation Verification)", () => {
    const sampleManifest = JSON.stringify({
      name: "sample-pkg",
      dependencies: {
        express: "4.21.2",
        pino: "9.0.0",
      },
      devDependencies: {
        typescript: "5.8.2",
      },
    });

    const validGt: readonly GroundTruthFact[] = [
      {
        id: "gt-dep-express",
        category: "dependency",
        attributes: { name: "express", version: "4.21.2", kind: "production" },
        provenance: "GROUND_TRUTH_SOURCE",
        sourceDescription: "package.json",
        migrationRelevance: "Prod",
      },
      {
        id: "gt-dep-pino",
        category: "dependency",
        attributes: { name: "pino", version: "9.0.0", kind: "production" },
        provenance: "GROUND_TRUTH_SOURCE",
        sourceDescription: "package.json",
        migrationRelevance: "Prod",
      },
      {
        id: "gt-dep-dev-typescript",
        category: "dependency",
        attributes: { name: "typescript", version: "5.8.2", kind: "development" },
        provenance: "GROUND_TRUTH_SOURCE",
        sourceDescription: "package.json",
        migrationRelevance: "Dev",
      },
    ];

    it("detects missing production dependency in ground truth", () => {
      const corruptedGt = validGt.filter((f) => (f.attributes as any).name !== "pino");
      const result = reconcileDependencyInventory(sampleManifest, corruptedGt);
      expect(result.isValid).toBe(false);
      expect(result.missingFromGT).toHaveLength(1);
      expect(result.missingFromGT[0]?.name).toBe("pino");
    });

    it("detects missing development dependency in ground truth", () => {
      const corruptedGt = validGt.filter((f) => (f.attributes as any).name !== "typescript");
      const result = reconcileDependencyInventory(sampleManifest, corruptedGt);
      expect(result.isValid).toBe(false);
      expect(result.missingFromGT).toHaveLength(1);
      expect(result.missingFromGT[0]?.name).toBe("typescript");
    });

    it("detects unexpected extra dependency in ground truth", () => {
      const corruptedGt = [
        ...validGt,
        {
          id: "gt-dep-ghost",
          category: "dependency" as const,
          attributes: { name: "ghost-pkg", version: "1.0.0", kind: "production" as const },
          provenance: "GROUND_TRUTH_SOURCE" as const,
          sourceDescription: "package.json",
          migrationRelevance: "Ghost",
        },
      ];
      const result = reconcileDependencyInventory(sampleManifest, corruptedGt);
      expect(result.isValid).toBe(false);
      expect(result.unexpectedInGT).toHaveLength(1);
      expect((result.unexpectedInGT[0]?.attributes as any).name).toBe("ghost-pkg");
    });

    it("detects version mismatch in ground truth", () => {
      const corruptedGt = validGt.map((f) =>
        (f.attributes as any).name === "express"
          ? { ...f, attributes: { ...f.attributes, version: "4.0.0" } }
          : f,
      );
      const result = reconcileDependencyInventory(sampleManifest, corruptedGt);
      expect(result.isValid).toBe(false);
      expect(result.versionMismatches).toHaveLength(1);
      expect(result.versionMismatches[0]?.name).toBe("express");
      expect(result.versionMismatches[0]?.gtVersion).toBe("4.0.0");
      expect(result.versionMismatches[0]?.manifestVersion).toBe("4.21.2");
    });

    it("detects inverted dependency kind (production vs development)", () => {
      const corruptedGt = validGt.map((f) =>
        (f.attributes as any).name === "typescript"
          ? { ...f, attributes: { ...f.attributes, kind: "production" } }
          : f,
      );
      const result = reconcileDependencyInventory(sampleManifest, corruptedGt);
      expect(result.isValid).toBe(false);
      expect(result.kindMismatches).toHaveLength(1);
      expect(result.kindMismatches[0]?.name).toBe("typescript");
      expect(result.kindMismatches[0]?.gtKind).toBe("production");
      expect(result.kindMismatches[0]?.manifestKind).toBe("development");
    });

    it("detects duplicate dependency facts in ground truth", () => {
      const corruptedGt = [...validGt, validGt[0]!];
      const result = reconcileDependencyInventory(sampleManifest, corruptedGt);
      expect(result.isValid).toBe(false);
      expect(result.duplicatesInGT).toContain("gt-dep-express");
    });

    it("detects known-negative violation if a known negative dependency is declared in manifest", () => {
      const gtWithKnownNeg: readonly GroundTruthFact[] = [
        ...validGt,
        {
          id: "gt-neg-dep-express",
          category: "dependency",
          isKnownNegative: true,
          attributes: { name: "express", kind: "production" },
          provenance: "KNOWN_NEGATIVE",
          sourceDescription: "Fake assertion that express is not in manifest",
          migrationRelevance: "Testing negative check",
        },
      ];
      const result = reconcileDependencyInventory(sampleManifest, gtWithKnownNeg);
      expect(result.isValid).toBe(false);
      expect(result.violatedKnownNegatives).toHaveLength(1);
      expect((result.violatedKnownNegatives[0]?.attributes as any).name).toBe("express");
    });
  });
});
