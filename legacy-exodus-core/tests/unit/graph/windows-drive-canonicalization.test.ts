import { describe, expect, test } from "bun:test";
import { canonicalizePath, DeterministicDependencyGraphBuilder, ModuleResolver } from "@graph/index";
import { DeterministicCallGraphBuilder } from "@semantic/call-graph-builder";
import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

describe("F-11: Windows Drive Letter Case Canonicalization", () => {
  describe("canonicalizePath", () => {
    test("normalizes uppercase Windows drive letter to lowercase", () => {
      expect(canonicalizePath("C:/project/src/app.js")).toBe("c:/project/src/app.js");
      expect(canonicalizePath("D:/workspace/index.ts")).toBe("d:/workspace/index.ts");
      expect(canonicalizePath("Z:/data/output.json")).toBe("z:/data/output.json");
    });

    test("normalizes Windows backslashes and drive letter casing simultaneously", () => {
      expect(canonicalizePath("C:\\project\\src\\app.js")).toBe("c:/project/src/app.js");
      expect(canonicalizePath("c:\\project\\src\\app.js")).toBe("c:/project/src/app.js");
      expect(canonicalizePath("D:\\workspace\\sub\\..\\index.ts")).toBe("d:/workspace/index.ts");
    });

    test("guarantees path equality regardless of input drive letter casing or separator style", () => {
      const upperSlash = canonicalizePath("C:/Users/test/src/app.js");
      const lowerSlash = canonicalizePath("c:/Users/test/src/app.js");
      const upperBackslash = canonicalizePath("C:\\Users\\test\\src\\app.js");
      const lowerBackslash = canonicalizePath("c:\\Users\\test\\src\\app.js");

      expect(upperSlash).toBe(lowerSlash);
      expect(upperSlash).toBe(upperBackslash);
      expect(upperSlash).toBe(lowerBackslash);
      expect(upperSlash).toBe("c:/Users/test/src/app.js");
    });

    test("handles root and drive-relative paths deterministically", () => {
      expect(canonicalizePath("C:")).toBe("c:");
      expect(canonicalizePath("C:/")).toBe("c:/");
      expect(canonicalizePath("C:\\")).toBe("c:/");
      expect(canonicalizePath("c:\\")).toBe("c:/");
    });

    test("normalizes drive letters with leading slash", () => {
      expect(canonicalizePath("/C:/workspace/index.ts")).toBe("/c:/workspace/index.ts");
      expect(canonicalizePath("/c:/workspace/index.ts")).toBe("/c:/workspace/index.ts");
    });

    test("preserves non-Windows absolute and relative paths unmodified", () => {
      expect(canonicalizePath("/usr/local/bin")).toBe("/usr/local/bin");
      expect(canonicalizePath("src/app.js")).toBe("src/app.js");
      expect(canonicalizePath("./src/app.js")).toBe("src/app.js");
      expect(canonicalizePath("../src/app.js")).toBe("../src/app.js");
      expect(canonicalizePath("")).toBe(".");
    });
  });

  describe("ModuleResolver.resolve", () => {
    test("resolves relative imports when importer has lowercase drive and target file has uppercase drive", () => {
      const resolver = new ModuleResolver();
      const files = [
        { id: "billing", path: "C:/project/src/billing.js", language: "javascript", size: 1 },
      ] as const;

      const result = resolver.resolve("c:/project/src/api.js", "./billing", files);
      expect(result.resolvedPath).toBe("c:/project/src/billing.js");
    });

    test("resolves relative imports when importer has uppercase drive and target file has lowercase drive", () => {
      const resolver = new ModuleResolver();
      const files = [
        { id: "billing", path: "c:/project/src/billing.js", language: "javascript", size: 1 },
      ] as const;

      const result = resolver.resolve("C:/project/src/api.js", "./billing", files);
      expect(result.resolvedPath).toBe("c:/project/src/billing.js");
    });

    test("resolves relative imports with mixed Windows backslashes and drive letter casing", () => {
      const resolver = new ModuleResolver();
      const files = [
        { id: "billing", path: "C:\\project\\src\\billing.js", language: "javascript", size: 1 },
      ] as const;

      const result = resolver.resolve("c:\\project\\src\\api.js", ".\\billing", files);
      expect(result.resolvedPath).toBe("c:/project/src/billing.js");
    });

    test("resolves alias imports across Windows drive boundaries", () => {
      const resolver = new ModuleResolver({
        baseUrl: "C:/project",
        paths: {
          "@services/*": ["src/services/*"],
        },
      });
      const files = [
        { id: "auth", path: "c:/project/src/services/auth.js", language: "javascript", size: 1 },
      ] as const;

      const result = resolver.resolve("C:/project/src/api.js", "@services/auth", files);
      expect(result.resolvedPath).toBe("c:/project/src/services/auth.js");
    });
  });

  describe("DeterministicDependencyGraphBuilder.build", () => {
    test("creates dependency edges when SymbolTables have mismatched drive letter casing", async () => {
      const parser = new JavaScriptParser();
      const extractor = new JavaScriptSymbolExtractor();
      const resolver = new ModuleResolver();

      const apiFile = { id: "api", path: "c:/project/src/api.js", language: "javascript", size: 1 } as const;
      const billingFile = { id: "billing", path: "C:/project/src/billing.js", language: "javascript", size: 1 } as const;

      const apiAst = (await parser.parse({ file: apiFile, source: 'import billing from "./billing"; export default billing;' })).result;
      const billingAst = (await parser.parse({ file: billingFile, source: "export default 42;" })).result;

      const apiTable = extractor.extract(apiAst);
      const billingTable = extractor.extract(billingAst);

      const graph = new DeterministicDependencyGraphBuilder(resolver).build([apiTable, billingTable], [apiFile, billingFile]);

      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]?.sourceFilePath).toBe("c:/project/src/api.js");
      expect(graph.edges[0]?.targetFilePath).toBe("c:/project/src/billing.js");

      // Verify all node filePaths are canonicalized with lowercase drive letters
      for (const node of graph.nodes) {
        expect(node.filePath.startsWith("c:/")).toBeTrue();
      }
    });

    test("detects cyclic imports when files use opposite drive letter casing", async () => {
      const parser = new JavaScriptParser();
      const extractor = new JavaScriptSymbolExtractor();
      const resolver = new ModuleResolver();

      const aFile = { id: "a", path: "c:/project/src/a.js", language: "javascript", size: 1 } as const;
      const bFile = { id: "b", path: "C:/project/src/b.js", language: "javascript", size: 1 } as const;

      const aAst = (await parser.parse({ file: aFile, source: 'import b from "./b"; export default b;' })).result;
      const bAst = (await parser.parse({ file: bFile, source: 'import a from "./a"; export default a;' })).result;

      const aTable = extractor.extract(aAst);
      const bTable = extractor.extract(bAst);

      const graph = new DeterministicDependencyGraphBuilder(resolver).build([aTable, bTable], [aFile, bFile]);

      expect(graph.edges).toHaveLength(2);
      expect(graph.cycles).toHaveLength(1);
      expect(graph.cycles[0]).toEqual(["c:/project/src/a.js", "c:/project/src/b.js", "c:/project/src/a.js"]);
    });
  });

  describe("DeterministicCallGraphBuilder.build", () => {
    test("resolves cross-file namespace calls across mismatched drive letter casing", async () => {
      const parser = new JavaScriptParser();
      const extractor = new JavaScriptSymbolExtractor();
      const resolver = new ModuleResolver();

      const apiFile = { id: "api", path: "c:/project/src/api.js", language: "javascript", size: 1 } as const;
      const billingFile = { id: "billing", path: "C:/project/src/billing.js", language: "javascript", size: 1 } as const;

      const apiAst = (await parser.parse({ file: apiFile, source: 'import * as billing from "./billing"; billing.charge();' })).result;
      const billingAst = (await parser.parse({ file: billingFile, source: "export function charge() {}" })).result;

      const apiTable = extractor.extract(apiAst);
      const billingTable = extractor.extract(billingAst);

      const depGraph = new DeterministicDependencyGraphBuilder(resolver).build([apiTable, billingTable], [apiFile, billingFile]);
      const callGraph = new DeterministicCallGraphBuilder().build([apiAst, billingAst], [apiTable, billingTable], depGraph);

      const chargeCall = callGraph.calls.find((c) => c.calleeName === "billing.charge");
      expect(chargeCall).toBeDefined();
      expect(chargeCall?.resolutionState).toBe("RESOLVED");
      expect(chargeCall?.targetSymbolId).toBeDefined();
    });

    test("resolves direct imported function calls when AST sourcePath and SymbolTable have opposite drive casing", async () => {
      const parser = new JavaScriptParser();
      const extractor = new JavaScriptSymbolExtractor();
      const resolver = new ModuleResolver();

      const authFile = { id: "auth", path: "C:/project/src/auth.js", language: "javascript", size: 1 } as const;
      const appFile = { id: "app", path: "c:/project/src/app.js", language: "javascript", size: 1 } as const;

      const authAst = (await parser.parse({ file: authFile, source: "export function login() {}" })).result;
      const appAst = (await parser.parse({ file: appFile, source: 'import { login } from "./auth"; login();' })).result;

      const authTable = extractor.extract(authAst);
      const appTable = extractor.extract(appAst);

      // Artificially simulate AST with uppercase drive and table with lowercase drive
      const modifiedAppAst = {
        ...appAst,
        metadata: {
          ...appAst.metadata,
          sourcePath: "C:/project/src/app.js",
        },
      };

      const depGraph = new DeterministicDependencyGraphBuilder(resolver).build([authTable, appTable], [authFile, appFile]);
      const callGraph = new DeterministicCallGraphBuilder().build([authAst, modifiedAppAst], [authTable, appTable], depGraph);

      const loginCall = callGraph.calls.find((c) => c.calleeName === "login");
      expect(loginCall).toBeDefined();
      expect(loginCall?.resolutionState).toBe("RESOLVED");
      expect(loginCall?.targetSymbolId).toBeDefined();
    });
  });
});
