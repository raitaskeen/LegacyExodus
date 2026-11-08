import { describe, expect, test } from "bun:test";

import { FactStore } from "@shared/fact-array";
import { callSchema, createSemanticAnalysis, referenceSchema, SortedFactList, type SemanticCall, type SymbolReference } from "@semantic/index";

const call = (key: string | undefined, id: string, sourceFilePath: string): SemanticCall => ({
  id, ...(key === undefined ? {} : { key }), sourceFilePath, callerName: "f", calleeName: "g", resolutionState: "UNRESOLVED",
});
const reference = (key: string, filePath: string, name: string): SymbolReference & { readonly extra: string } => ({
  id: `r-${key}`, key, filePath, name, kind: "identifier", resolutionState: "UNRESOLVED", extra: "dropped by the schema",
});

function inMemory(calls: readonly SemanticCall[], references: readonly SymbolReference[]) {
  return createSemanticAnalysis({ calls, references, scopes: [], deadCode: [], unusedImports: [], unusedExports: [], entryPoints: [], routes: [], middlewareChains: [] });
}

describe("ADR-009 step 3: calls and references written file by file", () => {
  test("files in path order, each sorted, give the order of the whole-run sort", () => {
    const store = FactStore.create();
    try {
      const files = [
        [call("a.js#g:call@1", "c2", "a.js"), call("a.js#g:call@0", "c1", "a.js")],
        [],
        [call("b.js#f:function/g:call@0", "c4", "b.js"), call("b.js#g:call@0", "c3", "b.js")],
      ];
      const list = new SortedFactList(store, callSchema);
      for (const file of files) list.appendFile(file);
      expect([...list.seal()]).toEqual([...inMemory(files.flat(), []).calls]);
    } finally {
      store.dispose();
    }
  });

  test("facts that do not sort by file (no key) are sorted once, in full, like the whole-run sort", () => {
    const store = FactStore.create();
    try {
      const files = [[call(undefined, "zz", "a.js"), call(undefined, "mm", "a.js")], [call(undefined, "aa", "b.js")]];
      const list = new SortedFactList(store, callSchema);
      for (const file of files) list.appendFile(file);
      const sealed = [...list.seal()];
      expect(sealed.map((item) => item.id)).toEqual(["aa", "mm", "zz"]);
      expect(sealed).toEqual([...inMemory(files.flat(), []).calls]);
    } finally {
      store.dispose();
    }
  });

  test("items are the schema's output, as the whole-run parse gives them", () => {
    const store = FactStore.create();
    try {
      const items = [reference("a.js#x:identifier@0", "a.js", "x")];
      const list = new SortedFactList(store, referenceSchema);
      list.appendFile(items);
      const [written] = [...list.seal()];
      expect(written).toEqual(inMemory([], items).references[0]!);
      expect(written).not.toHaveProperty("extra");
    } finally {
      store.dispose();
    }
  });
});
