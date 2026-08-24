import type {
  CategoryFidelityMetrics,
  FactMatchDetail,
  FidelityFactCategory,
  FidelityValidationReport,
  GroundTruthFact,
  ValidationWorldScope,
} from "@contracts/fidelity";

export function computeCategoryMetrics(
  category: FidelityFactCategory,
  worldScope: ValidationWorldScope,
  groundTruthFacts: readonly GroundTruthFact[],
  matchDetails: readonly FactMatchDetail[],
  scopedPredictedCount: number,
  unvalidatedPredictedCount: number,
): CategoryFidelityMetrics {
  const categoryGT = groundTruthFacts.filter((g) => g.category === category && !g.isKnownNegative);
  const categoryDetails = matchDetails.filter((d) => d.category === category);

  const truePositives = categoryDetails.filter((d) => d.status === "TRUE_POSITIVE").length;
  const falsePositives = categoryDetails.filter((d) => d.status === "FALSE_POSITIVE").length;
  const falseNegatives = categoryDetails.filter((d) => d.status === "FALSE_NEGATIVE").length;
  const unverifiedScopedCount = categoryDetails.filter((d) => d.status === "UNVERIFIED_SCOPED").length;
  const unvalidatedCount = categoryDetails.filter((d) => d.status === "UNVALIDATED").length;
  const actionableTruePositives = categoryDetails.filter((d) => d.status === "TRUE_POSITIVE" && d.isActionable).length;

  const groundTruthCount = categoryGT.length;
  const totalPredictedCount = scopedPredictedCount + unvalidatedPredictedCount;

  // Precision is mathematically meaningful only in CLOSED_WORLD scopes where all ungrounded predictions are false positives.
  const precision =
    worldScope === "CLOSED_WORLD" && truePositives + falsePositives > 0
      ? truePositives / (truePositives + falsePositives)
      : null;

  const recall =
    truePositives + falseNegatives > 0
      ? truePositives / (truePositives + falseNegatives)
      : null;

  const f1Score =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;

  const coverage =
    groundTruthCount > 0 ? (truePositives + falseNegatives) / groundTruthCount : 0;

  const actionableCorrectness =
    truePositives > 0 ? actionableTruePositives / truePositives : null;

  const status =
    groundTruthCount > 0 ? "MEASURED" : "NOT_MEASURED";

  return {
    category,
    worldScope,
    groundTruthCount,
    scopedPredictedCount,
    unvalidatedPredictedCount,
    totalPredictedCount,
    truePositives,
    falsePositives,
    falseNegatives,
    unverifiedScopedCount,
    unvalidatedCount,
    precision,
    recall,
    f1Score,
    coverage,
    actionableTruePositives,
    actionableCorrectness,
    status,
  };
}

export function compileReport(
  targetName: string,
  groundTruthFacts: readonly GroundTruthFact[],
  categories: readonly CategoryFidelityMetrics[],
  matchDetails: readonly FactMatchDetail[],
  options: {
    isSampleBased?: boolean;
    samplingMethodology?: string;
    limitations?: readonly string[];
  } = {},
): FidelityValidationReport {
  const totalGroundTruthFacts = groundTruthFacts.filter((g) => !g.isKnownNegative).length;
  const totalPredictedFacts = categories.reduce((sum, c) => sum + c.totalPredictedCount, 0);
  const totalValidatedScopePredictions = categories.reduce((sum, c) => sum + c.scopedPredictedCount, 0);
  const totalUnverifiedScopedPredictions = categories.reduce((sum, c) => sum + c.unverifiedScopedCount, 0);
  const totalUnvalidatedPredictions = categories.reduce((sum, c) => sum + c.unvalidatedPredictedCount, 0);

  const overallTruePositives = categories.reduce((sum, c) => sum + c.truePositives, 0);
  const overallFalsePositives = categories.reduce((sum, c) => sum + c.falsePositives, 0);
  const overallFalseNegatives = categories.reduce((sum, c) => sum + c.falseNegatives, 0);
  const totalActionable = categories.reduce((sum, c) => sum + c.actionableTruePositives, 0);

  // Overall precision is only computed if all evaluated categories with facts are CLOSED_WORLD
  const hasSampleBasedCategory = categories.some(
    (c) => c.worldScope === "OPEN_WORLD_SAMPLE" && (c.groundTruthCount > 0 || c.scopedPredictedCount > 0),
  );
  const overallPrecision =
    !hasSampleBasedCategory && overallTruePositives + overallFalsePositives > 0
      ? overallTruePositives / (overallTruePositives + overallFalsePositives)
      : null;

  const overallRecall =
    overallTruePositives + overallFalseNegatives > 0
      ? overallTruePositives / (overallTruePositives + overallFalseNegatives)
      : null;

  const overallF1Score =
    overallPrecision !== null && overallRecall !== null && overallPrecision + overallRecall > 0
      ? (2 * overallPrecision * overallRecall) / (overallPrecision + overallRecall)
      : null;

  const overallActionableCorrectness =
    overallTruePositives > 0 ? totalActionable / overallTruePositives : null;

  let actionableVerdict: "ACTIONABLE" | "PARTIALLY_ACTIONABLE" | "NON_ACTIONABLE" = "ACTIONABLE";
  if (overallActionableCorrectness === null || overallActionableCorrectness < 0.7) {
    actionableVerdict = "NON_ACTIONABLE";
  } else if (overallActionableCorrectness < 0.95 || (overallPrecision !== null && overallPrecision < 0.95)) {
    actionableVerdict = "PARTIALLY_ACTIONABLE";
  }

  // Absolute migration-safety rule: sample-based validation does NOT establish whole-repository migration safety.
  const migrationSafetyVerdict: "MIGRATION_SAFETY_NOT_YET_ESTABLISHED" | "MIGRATION_VALIDATED" =
    options.isSampleBased || overallRecall === null || overallRecall < 0.99
      ? "MIGRATION_SAFETY_NOT_YET_ESTABLISHED"
      : "MIGRATION_VALIDATED";

  const limitations = options.limitations ?? [
    "Sample-based ground truth validates fidelity within verified files, but does NOT prove whole-repository migration correctness.",
    "Predictions outside the validated ground-truth universe are classified as UNVALIDATED, not False Positives.",
    "Dynamic property access and runtime monkey-patching are out of static analysis scope.",
  ];

  return {
    targetName,
    timestamp: new Date().toISOString(),
    isSampleBased: options.isSampleBased ?? true,
    samplingMethodology: options.samplingMethodology,
    totalGroundTruthFacts,
    totalPredictedFacts,
    totalValidatedScopePredictions,
    totalUnverifiedScopedPredictions,
    totalUnvalidatedPredictions,
    overallTruePositives,
    overallFalsePositives,
    overallFalseNegatives,
    overallPrecision,
    overallRecall,
    overallF1Score,
    overallActionableCorrectness,
    categories,
    matchDetails,
    actionableVerdict,
    migrationSafetyVerdict,
    limitations,
  };
}
