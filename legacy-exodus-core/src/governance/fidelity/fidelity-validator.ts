import type {
  CategoryFidelityMetrics,
  FactMatchDetail,
  FidelityFactCategory,
  FidelityValidationReport,
  GroundTruthFact,
  ValidationWorldScope,
} from "@contracts/fidelity";
import { isFactActionable, matchFact, normalizePath } from "./fidelity-matcher";
import { computeCategoryMetrics, compileReport } from "./fidelity-metrics";

export interface PredictionPayload {
  readonly files?: readonly Record<string, unknown>[];
  readonly dependencies?: readonly Record<string, unknown>[];
  readonly frameworks?: readonly Record<string, unknown>[];
  readonly symbols?: readonly Record<string, unknown>[];
  readonly imports?: readonly Record<string, unknown>[];
  readonly exports?: readonly Record<string, unknown>[];
  readonly dependencyEdges?: readonly Record<string, unknown>[];
  readonly calls?: readonly Record<string, unknown>[];
  readonly cfgs?: readonly Record<string, unknown>[];
  readonly dfgs?: readonly Record<string, unknown>[];
  readonly routes?: readonly Record<string, unknown>[];
  readonly hooks?: readonly Record<string, unknown>[];
}

export interface ValidationScopeOptions {
  readonly targetName: string;
  readonly isSampleBased?: boolean;
  readonly samplingMethodology?: string;
  /** Explicit list of file paths that are under closed-world evaluation */
  readonly closedScopeFilePaths?: readonly string[];
  readonly categoryScopes?: Partial<Record<FidelityFactCategory, ValidationWorldScope>>;
  readonly limitations?: readonly string[];
}

export class MigrationFidelityValidator {
  public validate(
    groundTruthFacts: readonly GroundTruthFact[],
    predictions: PredictionPayload,
    options: ValidationScopeOptions,
  ): FidelityValidationReport {
    const positiveGT = groundTruthFacts.filter((g) => !g.isKnownNegative);
    const knownNegativeGT = groundTruthFacts.filter((g) => g.isKnownNegative);

    // Collect file paths that have positive ground truth
    const gtFilePaths = new Set(
      positiveGT
        .map((g) => (g.filePath ? normalizePath(g.filePath) : g.category === "file" ? normalizePath(String((g.attributes as any).path)) : undefined))
        .filter((p): p is string => Boolean(p)),
    );

    const closedScopeFiles = new Set(
      (options.closedScopeFilePaths ?? Array.from(gtFilePaths)).map(normalizePath),
    );

    const matchDetails: FactMatchDetail[] = [];
    const categories: CategoryFidelityMetrics[] = [];

    const categoryMap: Record<FidelityFactCategory, readonly Record<string, unknown>[]> = {
      file: predictions.files ?? [],
      dependency: predictions.dependencies ?? [],
      framework: predictions.frameworks ?? [],
      symbol: predictions.symbols ?? [],
      import: predictions.imports ?? [],
      export: predictions.exports ?? [],
      dependency_edge: predictions.dependencyEdges ?? [],
      call: predictions.calls ?? [],
      cfg: predictions.cfgs ?? [],
      dfg: predictions.dfgs ?? [],
      route: predictions.routes ?? [],
      hook: predictions.hooks ?? [],
    };

    const evaluatedCategories: FidelityFactCategory[] = [
      "file",
      "dependency",
      "framework",
      "symbol",
      "import",
      "export",
      "dependency_edge",
      "call",
      "cfg",
      "dfg",
    ];

    for (const cat of evaluatedCategories) {
      const gtForCat = positiveGT.filter((g) => g.category === cat);
      const knownNegativesForCat = knownNegativeGT.filter((g) => g.category === cat);
      const allPredsForCat = categoryMap[cat];

      // If category has zero ground truth and zero known negatives, it is NOT_MEASURED -> all predictions UNVALIDATED
      if (gtForCat.length === 0 && knownNegativesForCat.length === 0) {
        for (const pred of allPredsForCat) {
          matchDetails.push({
            category: cat,
            status: "UNVALIDATED",
            prediction: pred,
            isActionable: false,
            notes: `Category '${cat}' has no ground truth defined in this evaluation.`,
          });
        }
        categories.push(
          computeCategoryMetrics(
            cat,
            "OPEN_WORLD_SAMPLE",
            [],
            matchDetails,
            0,
            allPredsForCat.length,
          ),
        );
        continue;
      }

      // Determine default world scope for category
      const worldScope: ValidationWorldScope =
        options.categoryScopes?.[cat] ??
        (cat === "dependency" || cat === "framework"
          ? "CLOSED_WORLD"
          : options.isSampleBased
            ? "OPEN_WORLD_SAMPLE"
            : "CLOSED_WORLD");

      // Partition predictions into scoped vs unvalidated
      const scopedPreds: { pred: Record<string, unknown>; originalIndex: number }[] = [];
      const unvalidatedPreds: { pred: Record<string, unknown>; originalIndex: number }[] = [];

      for (let i = 0; i < allPredsForCat.length; i++) {
        const pred = allPredsForCat[i]!;
        const predFile = getPredictionFilePath(cat, pred);

        if (worldScope === "CLOSED_WORLD" || !predFile || closedScopeFiles.has(normalizePath(predFile))) {
          scopedPreds.push({ pred, originalIndex: i });
        } else {
          unvalidatedPreds.push({ pred, originalIndex: i });
        }
      }

      const matchedGtIds = new Set<string>();
      const matchedScopedPredIndices = new Set<number>();

      // 1. Evaluate known-negative facts (assertions that an entity must NOT exist)
      for (const neg of knownNegativesForCat) {
        for (let i = 0; i < scopedPreds.length; i++) {
          const { pred } = scopedPreds[i]!;
          if (matchFact(neg, pred)) {
            matchedScopedPredIndices.add(i);
            matchDetails.push({
              category: cat,
              status: "FALSE_POSITIVE",
              groundTruth: neg,
              prediction: pred,
              isActionable: false,
              notes: `Known-negative fact violated: ${neg.sourceDescription}`,
            });
          }
        }
      }

      // 2. Match Ground Truth against Scoped Predictions
      for (const gt of gtForCat) {
        let foundMatch = false;
        for (let i = 0; i < scopedPreds.length; i++) {
          if (matchedScopedPredIndices.has(i)) continue;
          const { pred } = scopedPreds[i]!;
          if (matchFact(gt, pred)) {
            foundMatch = true;
            matchedGtIds.add(gt.id);
            matchedScopedPredIndices.add(i);
            const actionable = isFactActionable(gt, pred);
            matchDetails.push({
              category: cat,
              status: "TRUE_POSITIVE",
              groundTruth: gt,
              prediction: pred,
              isActionable: actionable,
              notes: gt.migrationRelevance,
            });
            break;
          }
        }

        if (!foundMatch) {
          matchDetails.push({
            category: cat,
            status: "FALSE_NEGATIVE",
            groundTruth: gt,
            isActionable: false,
            notes: `Missing ground-truth fact: ${gt.sourceDescription} (${gt.migrationRelevance})`,
          });
        }
      }

      // 3. Unmatched Scoped Predictions -> FALSE_POSITIVE (in closed world) or UNVERIFIED_SCOPED (in open-world sample)
      for (let i = 0; i < scopedPreds.length; i++) {
        if (!matchedScopedPredIndices.has(i)) {
          const { pred } = scopedPreds[i]!;
          if (worldScope === "CLOSED_WORLD") {
            matchDetails.push({
              category: cat,
              status: "FALSE_POSITIVE",
              prediction: pred,
              isActionable: false,
              notes: `Prediction in closed-world scope has no matching ground truth: ${JSON.stringify(pred)}`,
            });
          } else {
            matchDetails.push({
              category: cat,
              status: "UNVERIFIED_SCOPED",
              prediction: pred,
              isActionable: false,
              notes: "Prediction is inside open-world sampled file, but unverified by representative ground truth.",
            });
          }
        }
      }

      // 4. Unvalidated Predictions -> UNVALIDATED (outside scope)
      for (const { pred } of unvalidatedPreds) {
        matchDetails.push({
          category: cat,
          status: "UNVALIDATED",
          prediction: pred,
          isActionable: false,
          notes: "Prediction is outside the validated ground-truth universe.",
        });
      }

      const catMetric = computeCategoryMetrics(
        cat,
        worldScope,
        gtForCat,
        matchDetails,
        scopedPreds.length,
        unvalidatedPreds.length,
      );
      categories.push(catMetric);
    }

    return compileReport(options.targetName, groundTruthFacts, categories, matchDetails, {
      isSampleBased: options.isSampleBased ?? true,
      samplingMethodology: options.samplingMethodology,
      limitations: options.limitations,
    });
  }
}

function getPredictionFilePath(category: FidelityFactCategory, pred: Record<string, unknown>): string | undefined {
  if (category === "file") return String(pred.path ?? "");
  if (category === "symbol" || category === "import" || category === "export" || category === "call" || category === "cfg" || category === "dfg") {
    return String(pred.filePath ?? pred.sourceFilePath ?? "");
  }
  if (category === "dependency_edge") {
    return String(pred.sourceFilePath ?? pred.source ?? "");
  }
  return undefined;
}
