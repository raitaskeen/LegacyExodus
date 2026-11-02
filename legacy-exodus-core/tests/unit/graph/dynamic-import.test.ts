import { describe, expect, test } from "bun:test";

import type { FileArtifact } from "@contracts/discovery";
import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { validateDependencyGraph } from "@graph/dependency-graph-contracts";
import { JavaScriptParser, type ASTResult } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/semantic-engine";
import { JavaScriptSymbolExtractor, type SymbolTable } from "@symbols/index";

async function analyze(sources: Readonly<Record<string, string>>) {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const files: FileArtifact[] = [];
  const astResults: ASTResult[] = [];
  const symbolTables: SymbolTable[] = [];
  for (const [path, source] of Object.entries(sources)) {
    const file: FileArtifact = { id: `file:${path}`, path, language: "javascript", size: source.length };
    const ast = (await parser.parse({ file, source })).result;
    files.push(file);
    astResults.push(ast);
    symbolTables.push(extractor.extract(ast));
  }
  const graph = new DeterministicDependencyGraphBuilder().build(symbolTables, files);
  const semantic = new DeterministicSemanticAnalysisEngine().analyze({ astResults, symbolTables, dependencyGraph: graph });
  const moduleEdges = graph.moduleGraph.edges.map((edge) => `${edge.sourceFilePath}->${edge.targetFilePath}|${edge.moduleSpecifier}|${edge.form}`);
  const unresolved = (graph.moduleGraph.unresolvedReferences ?? []).map((reference) => `${reference.sourceFilePath}|${reference.form}`);
  const unused = semantic.unusedExports.map((finding) => `${finding.filePath}:${finding.name}:${finding.state}`).sort();
  return { graph, moduleEdges, unresolved, unused };
}

const lib = "export function lazy() { return 1; }\n";
const other = "export const lonely = 1;\n";

describe("BA-10 dynamic import and computed require", () => {
  test("a literal import() is a module edge and binds no export", async () => {
    const { graph, moduleEdges, unresolved } = await analyze({
      "lib.js": lib,
      "main.js": "export async function load() { const m = await import('./lib.js'); return m.lazy(); }\n",
    });
    expect(moduleEdges).toEqual(["main.js->lib.js|./lib.js|dynamic-import"]);
    expect(graph.edges).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  test("a no-substitution template literal is a literal specifier", async () => {
    const { moduleEdges } = await analyze({ "lib.js": lib, "main.js": "import(`./lib.js`);\n" });
    expect(moduleEdges).toEqual(["main.js->lib.js|./lib.js|dynamic-import"]);
  });

  test("exports of a dynamically imported module are not unused; others keep their finding", async () => {
    const { unused } = await analyze({ "lib.js": lib, "other.js": other, "main.js": "import('./lib.js').then((m) => use(m));\n" });
    expect(unused).toEqual(["other.js:lonely:INFERRED"]);
  });

  test("computed import() and require() are recorded unresolved and put unused exports under review", async () => {
    const { moduleEdges, unresolved, unused } = await analyze({
      "other.js": other,
      "main.js": "const name = './other.js';\nimport(name);\nmodule.exports = () => require(name);\nimport(`./${name}`);\n",
    });
    expect(moduleEdges).toEqual([]);
    expect(unresolved).toEqual(["main.js|dynamic-import", "main.js|commonjs-import", "main.js|dynamic-import"]);
    expect(unused).toEqual(["main.js:default:REQUIRES_REVIEW", "other.js:lonely:REQUIRES_REVIEW"]);
  });

  test("the module layer with unresolved references round-trips through validation", async () => {
    const { graph } = await analyze({ "main.js": "import(name);\n" });
    expect(validateDependencyGraph(JSON.parse(JSON.stringify(graph))).moduleGraph).toEqual(graph.moduleGraph);
  });
});
