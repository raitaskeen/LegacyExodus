import type {
  GroundTruthFact,
  GroundTruthSymbol,
  GroundTruthImport,
  GroundTruthExport,
  GroundTruthDependency,
  GroundTruthDependencyEdge,
  GroundTruthCall,
  GroundTruthFile,
  GroundTruthCFG,
  GroundTruthDFG,
} from "@contracts/fidelity";

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function matchFact(
  gt: GroundTruthFact,
  prediction: Record<string, unknown>,
): boolean {
  if (gt.category === "file") {
    const gtAttr = gt.attributes as unknown as GroundTruthFile;
    const predPath = normalizePath(String(prediction.path ?? ""));
    const gtPath = normalizePath(gtAttr.path);
    if (predPath !== gtPath) return false;
    if (gtAttr.language && String(prediction.language ?? "").toLowerCase() !== gtAttr.language.toLowerCase()) {
      return false;
    }
    return true;
  }

  if (gt.category === "dependency") {
    const gtAttr = gt.attributes as unknown as GroundTruthDependency;
    const predName = String(prediction.name ?? "");
    if (predName !== gtAttr.name) return false;
    if (gtAttr.kind && prediction.kind !== gtAttr.kind) return false;
    return true;
  }

  if (gt.category === "framework") {
    const gtName = String((gt.attributes as Record<string, unknown>).name ?? "");
    const predName = String(prediction.name ?? "");
    return predName.toLowerCase() === gtName.toLowerCase();
  }

  if (gt.category === "symbol") {
    const gtAttr = gt.attributes as unknown as GroundTruthSymbol;
    const predFile = normalizePath(String(prediction.filePath ?? ""));
    const gtFile = normalizePath(gtAttr.filePath);
    const predName = String(prediction.name ?? "");
    if (predFile !== gtFile || predName !== gtAttr.name) return false;
    if (gtAttr.kind && gtAttr.kind !== "unknown" && prediction.kind !== gtAttr.kind) return false;
    if (gtAttr.exported !== undefined && Boolean(prediction.exported) !== gtAttr.exported) return false;
    return true;
  }

  if (gt.category === "import") {
    const gtAttr = gt.attributes as unknown as GroundTruthImport;
    const predFile = normalizePath(String(prediction.filePath ?? ""));
    const gtFile = normalizePath(gtAttr.filePath);
    const predModule = String(prediction.moduleSpecifier ?? "");
    const predLocal = String(prediction.localName ?? prediction.name ?? "");
    if (predFile !== gtFile) return false;
    if (normalizeModuleSpecifier(predModule) !== normalizeModuleSpecifier(gtAttr.moduleSpecifier)) return false;
    if (gtAttr.localName && predLocal !== gtAttr.localName) return false;
    return true;
  }

  if (gt.category === "export") {
    const gtAttr = gt.attributes as unknown as GroundTruthExport;
    const predFile = normalizePath(String(prediction.filePath ?? ""));
    const gtFile = normalizePath(gtAttr.filePath);
    const predName = String(prediction.exportName ?? prediction.name ?? "");
    const sourceName = typeof prediction.sourceSymbolName === "string" ? prediction.sourceSymbolName : undefined;
    if (predFile !== gtFile) return false;
    if (predName !== gtAttr.exportName && sourceName !== gtAttr.exportName) return false;
    if (gtAttr.defaultExport !== undefined && Boolean(prediction.defaultExport) !== gtAttr.defaultExport) return false;
    return true;
  }

  if (gt.category === "dependency_edge") {
    const gtAttr = gt.attributes as unknown as GroundTruthDependencyEdge;
    const predSource = normalizePath(String(prediction.sourceFilePath ?? prediction.source ?? ""));
    const predTarget = normalizePath(String(prediction.targetFilePath ?? prediction.target ?? ""));
    const gtSource = normalizePath(gtAttr.sourceFilePath);
    const gtTarget = normalizePath(gtAttr.targetFilePath);
    if (predSource !== gtSource) return false;
    if (predTarget !== gtTarget && !predTarget.endsWith(gtTarget) && !gtTarget.endsWith(predTarget)) return false;
    return true;
  }

  if (gt.category === "call") {
    const gtAttr = gt.attributes as unknown as GroundTruthCall;
    const predFile = normalizePath(String(prediction.sourceFilePath ?? prediction.filePath ?? ""));
    const gtFile = normalizePath(gtAttr.sourceFilePath);
    const predCallee = String(prediction.calleeName ?? prediction.name ?? "");
    if (predFile !== gtFile || predCallee !== gtAttr.calleeName) return false;
    if (gtAttr.resolutionState && prediction.resolutionState !== gtAttr.resolutionState) return false;
    if (gtAttr.targetFilePath && prediction.targetFilePath) {
      const predTarget = normalizePath(String(prediction.targetFilePath));
      const gtTarget = normalizePath(gtAttr.targetFilePath);
      if (predTarget !== gtTarget) return false;
    }
    return true;
  }

  if (gt.category === "cfg") {
    const gtAttr = gt.attributes as unknown as GroundTruthCFG;
    const predFile = normalizePath(String(prediction.filePath ?? ""));
    const gtFile = normalizePath(gtAttr.filePath);
    if (predFile !== gtFile) return false;
    if (gtAttr.functionName && prediction.functionName !== gtAttr.functionName) return false;
    const blockCount = Array.isArray(prediction.blocks) ? prediction.blocks.length : Number(prediction.blockCount ?? 0);
    if (gtAttr.minBlockCount !== undefined && blockCount < gtAttr.minBlockCount) return false;
    const edgeCount = Array.isArray(prediction.edges) ? prediction.edges.length : Number(prediction.edgeCount ?? 0);
    if (gtAttr.minEdgeCount !== undefined && edgeCount < gtAttr.minEdgeCount) return false;
    return true;
  }

  if (gt.category === "dfg") {
    const gtAttr = gt.attributes as unknown as GroundTruthDFG;
    const predFile = normalizePath(String(prediction.filePath ?? ""));
    const gtFile = normalizePath(gtAttr.filePath);
    if (predFile !== gtFile) return false;
    if (gtAttr.functionName && prediction.functionName !== gtAttr.functionName) return false;
    const defCount = Array.isArray(prediction.definitions) ? prediction.definitions.length : Number(prediction.defCount ?? 0);
    if (gtAttr.minDefinitionCount !== undefined && defCount < gtAttr.minDefinitionCount) return false;
    const useCount = Array.isArray(prediction.uses) ? prediction.uses.length : Number(prediction.useCount ?? 0);
    if (gtAttr.minUseCount !== undefined && useCount < gtAttr.minUseCount) return false;
    return true;
  }

  return false;
}

export function isFactActionable(gt: GroundTruthFact, prediction: Record<string, unknown>): boolean {
  if (gt.category === "file") {
    const p = String(prediction.path ?? "");
    const lang = String(prediction.language ?? "");
    return p.length > 0 && lang.length > 0;
  }
  if (gt.category === "dependency") {
    const n = String(prediction.name ?? "");
    return n.length > 0;
  }
  if (gt.category === "import") {
    const spec = String(prediction.moduleSpecifier ?? "");
    const local = String(prediction.localName ?? prediction.name ?? "");
    return spec.length > 0 && local.length > 0;
  }
  if (gt.category === "export") {
    const name = String(prediction.exportName ?? prediction.name ?? "");
    return name.length > 0;
  }
  if (gt.category === "symbol") {
    const name = String(prediction.name ?? "");
    const kind = String(prediction.kind ?? "");
    return name.length > 0 && kind !== "unknown";
  }
  if (gt.category === "dependency_edge") {
    const src = String(prediction.sourceFilePath ?? prediction.source ?? "");
    const tgt = String(prediction.targetFilePath ?? prediction.target ?? "");
    return src.length > 0 && tgt.length > 0;
  }
  if (gt.category === "call") {
    if (prediction.resolutionState === "RESOLVED") {
      return Boolean(prediction.targetSymbolId || prediction.targetFilePath);
    }
    return Boolean(prediction.calleeName || prediction.name);
  }
  if (gt.category === "cfg") {
    const blocks = Array.isArray(prediction.blocks) ? prediction.blocks.length : Number(prediction.blockCount ?? 0);
    return blocks > 0;
  }
  if (gt.category === "dfg") {
    const defs = Array.isArray(prediction.definitions) ? prediction.definitions.length : Number(prediction.defCount ?? 0);
    return defs > 0;
  }
  return true;
}

function normalizeModuleSpecifier(spec: string): string {
  return spec.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.js$/, "").replace(/\.ts$/, "");
}
