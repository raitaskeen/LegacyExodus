import { describe, expect, test } from "bun:test";

import type { FileArtifact } from "@contracts/discovery";
import { DeterministicDependencyGraphBuilder, ModuleResolver } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

const files: readonly FileArtifact[] = [
  { id: "api", path: "src/api.js", language: "javascript", size: 1 },
  { id: "billing", path: "src/billing.js", language: "javascript", size: 1 },
  { id: "barrel", path: "src/utils/index.js", language: "javascript", size: 1 },
];

describe("ModuleResolver", () => {
  test("resolves explicit and wildcard TypeScript path aliases without resolving packages", (): void => {
    const resolver = new ModuleResolver({ baseUrl: "src", paths: { "@/*": ["*"], "@services/*": ["services/*"], "external": ["missing"] } });
    const files = [
      { id: "api", path: "src/api.ts", language: "typescript", size: 1 },
      { id: "service", path: "src/services/users.ts", language: "typescript", size: 1 },
    ] as const;

    expect(resolver.resolve("src/main.ts", "@/api", files).resolvedPath).toBe("src/api.ts");
    expect(resolver.resolve("src/main.ts", "@services/users", files).resolvedPath).toBe("src/services/users.ts");
    expect(resolver.resolve("src/main.ts", "express", files).resolvedPath).toBeNull();
    expect(resolver.resolve("src/main.ts", "external", files).resolvedPath).toBeNull();
  });

  test("resolves relative paths, extensions, and directory index modules deterministically", (): void => {
    const resolver = new ModuleResolver();

    expect(resolver.resolve("src/api.js", "./billing", files).resolvedPath).toBe("src/billing.js");
    expect(resolver.resolve("src/api.js", "./utils", files).resolvedPath).toBe("src/utils/index.js");
    expect(resolver.resolve("src/api.js", "express", files).resolvedPath).toBeNull();
  });

  test("resolves JSX and TSX directory index modules", (): void => {
    const resolver = new ModuleResolver();
    const jsxFiles: readonly FileArtifact[] = [
      { id: "api", path: "src/api.js", language: "javascript", size: 1 },
      { id: "jsx", path: "src/ui/index.jsx", language: "javascript", size: 1 },
      { id: "tsx", path: "src/view/index.tsx", language: "typescript", size: 1 },
    ];

    expect(resolver.resolve("src/api.js", "./ui", jsxFiles).resolvedPath).toBe("src/ui/index.jsx");
    expect(resolver.resolve("src/api.js", "./view", jsxFiles).resolvedPath).toBe("src/view/index.tsx");
  });

  test("does not fabricate edges for unavailable named exports", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const fixtureFiles = [
      { id: "app", path: "src/app.js", language: "javascript", size: 1 },
      { id: "barrel", path: "src/services/index.js", language: "javascript", size: 1 },
      { id: "auth", path: "src/services/auth.js", language: "javascript", size: 1 },
    ] as const;
    const app = extractor.extract((await parser.parse({ file: fixtureFiles[0], source: 'import { missing } from "./services";' })).result);
    const barrel = extractor.extract((await parser.parse({ file: fixtureFiles[1], source: 'export * from "./auth";' })).result);
    const auth = extractor.extract((await parser.parse({ file: fixtureFiles[2], source: "export function login() {}" })).result);
    const graph = new DeterministicDependencyGraphBuilder().build([app, barrel, auth], fixtureFiles);

    expect(graph.edges).toEqual([]);
  });

  test("builds a directed edge from a local import to a target export", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const api = extractor.extract((await parser.parse({ file: files[0]!, source: 'import Billing from "./billing";' })).result);
    const billing = extractor.extract((await parser.parse({ file: files[1]!, source: "export default class Billing {}" })).result);
    const graph = new DeterministicDependencyGraphBuilder().build([api, billing], files);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.sourceFilePath).toBe("src/api.js");
    expect(graph.edges[0]?.targetFilePath).toBe("src/billing.js");
    expect(Object.isFrozen(graph)).toBe(true);
  });

  test("terminates and reports circular file dependencies", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const cycleFiles = [
      { id: "a", path: "src/a.js", language: "javascript", size: 1 },
      { id: "b", path: "src/b.js", language: "javascript", size: 1 },
    ] as const;
    const a = extractor.extract((await parser.parse({ file: cycleFiles[0], source: 'import b from "./b"; export default b;' })).result);
    const b = extractor.extract((await parser.parse({ file: cycleFiles[1], source: 'import a from "./a"; export default a;' })).result);
    const graph = new DeterministicDependencyGraphBuilder().build([a, b], cycleFiles);
    expect(graph.cycles.length).toBeGreaterThan(0);
  });

  test("resolves named re-exports to the originating symbol", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const barrelFiles = [
      { id: "app", path: "src/app.js", language: "javascript", size: 1 },
      { id: "barrel", path: "src/services/index.js", language: "javascript", size: 1 },
      { id: "auth", path: "src/services/auth.js", language: "javascript", size: 1 },
    ] as const;
    const app = extractor.extract((await parser.parse({ file: barrelFiles[0], source: 'import { login } from "./services";' })).result);
    const barrel = extractor.extract((await parser.parse({ file: barrelFiles[1], source: 'export { login } from "./auth";' })).result);
    const auth = extractor.extract((await parser.parse({ file: barrelFiles[2], source: "export function login() {}" })).result);
    expect(barrel.symbols.find((symbol) => symbol.kind === "export")?.moduleSpecifier).toBe("./auth");
    const graph = new DeterministicDependencyGraphBuilder().build([app, barrel, auth], barrelFiles);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.targetFilePath).toBe("src/services/auth.js");
  });

  test("resolves aliased named re-exports to the original symbol", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const fixtureFiles = [
      { id: "app", path: "src/app.js", language: "javascript", size: 1 },
      { id: "barrel", path: "src/services/index.js", language: "javascript", size: 1 },
      { id: "auth", path: "src/services/auth.js", language: "javascript", size: 1 },
    ] as const;
    const app = extractor.extract((await parser.parse({ file: fixtureFiles[0], source: 'import { signIn } from "./services";' })).result);
    const barrel = extractor.extract((await parser.parse({ file: fixtureFiles[1], source: 'export { login as signIn } from "./auth";' })).result);
    const auth = extractor.extract((await parser.parse({ file: fixtureFiles[2], source: "export function login() {}" })).result);
    const graph = new DeterministicDependencyGraphBuilder().build([app, barrel, auth], fixtureFiles);

    expect(barrel.symbols.find((symbol) => symbol.kind === "export")?.sourceSymbolName).toBe("login");
    expect(graph.edges[0]?.targetFilePath).toBe("src/services/auth.js");
    expect(graph.edges[0]?.targetExportSymbolId).toBe(auth.symbols.find((symbol) => symbol.kind === "export")?.id);
  });

  test("resolves wildcard exports through recursive barrel files", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const fixtureFiles = [
      { id: "app", path: "src/app.js", language: "javascript", size: 1 },
      { id: "services", path: "src/services/index.js", language: "javascript", size: 1 },
      { id: "api", path: "src/services/api/index.ts", language: "javascript", size: 1 },
      { id: "auth", path: "src/services/api/auth.ts", language: "javascript", size: 1 },
    ] as const;
    const app = extractor.extract((await parser.parse({ file: fixtureFiles[0], source: 'import { login } from "./services";' })).result);
    const services = extractor.extract((await parser.parse({ file: fixtureFiles[1], source: 'export * from "./api";' })).result);
    const api = extractor.extract((await parser.parse({ file: fixtureFiles[2], source: 'export * from "./auth";' })).result);
    const auth = extractor.extract((await parser.parse({ file: fixtureFiles[3], source: "export function login() {}" })).result);
    const graph = new DeterministicDependencyGraphBuilder().build([app, services, api, auth], fixtureFiles);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.targetFilePath).toBe("src/services/api/auth.ts");
    expect(graph.edges[0]?.targetExportSymbolId).toBe(auth.symbols.find((symbol) => symbol.kind === "export")?.id);
  });

  test("resolves namespace wildcard re-exports to their source module", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const fixtureFiles = [
      { id: "app", path: "src/app.js", language: "javascript", size: 1 },
      { id: "barrel", path: "src/services/index.js", language: "javascript", size: 1 },
      { id: "auth", path: "src/services/auth.js", language: "javascript", size: 1 },
    ] as const;
    const app = extractor.extract((await parser.parse({ file: fixtureFiles[0], source: 'import { authNamespace } from "./services";' })).result);
    const barrel = extractor.extract((await parser.parse({ file: fixtureFiles[1], source: 'export * as authNamespace from "./auth";' })).result);
    const auth = extractor.extract((await parser.parse({ file: fixtureFiles[2], source: "export function login() {}" })).result);
    const graph = new DeterministicDependencyGraphBuilder().build([app, barrel, auth], fixtureFiles);

    const namespaceExport = barrel.symbols.find((symbol) => symbol.kind === "export");
    expect(namespaceExport?.sourceSymbolName).toBe("*");
    // The import binds the namespace object the barrel re-exports, not one of auth.js's exports (BA-09).
    expect(graph.edges.map((edge) => [edge.targetFilePath, edge.targetExportSymbolId])).toEqual([["src/services/index.js", namespaceExport?.id ?? "missing"]]);
    expect(graph.moduleGraph.edges.map((edge) => edge.targetFilePath)).toEqual(["src/services/index.js"]);
  });

  test("records cyclic barrels while preserving their valid import edges", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const fixtureFiles = [
      { id: "app", path: "src/app.js", language: "javascript", size: 1 },
      { id: "a", path: "src/a/index.js", language: "javascript", size: 1 },
      { id: "b", path: "src/b/index.js", language: "javascript", size: 1 },
    ] as const;
    const app = extractor.extract((await parser.parse({ file: fixtureFiles[0], source: 'import a from "./a";' })).result);
    const a = extractor.extract((await parser.parse({ file: fixtureFiles[1], source: 'import b from "../b"; export default b;' })).result);
    const b = extractor.extract((await parser.parse({ file: fixtureFiles[2], source: 'import a from "../a"; export default a;' })).result);
    const graph = new DeterministicDependencyGraphBuilder().build([app, a, b], fixtureFiles);

    expect(graph.edges.some((edge) => edge.sourceFilePath === "src/a/index.js" && edge.targetFilePath === "src/b/index.js")).toBe(true);
    expect(graph.edges.some((edge) => edge.sourceFilePath === "src/b/index.js" && edge.targetFilePath === "src/a/index.js")).toBe(true);
    expect(graph.cycles).toContainEqual(["src/a/index.js", "src/b/index.js", "src/a/index.js"]);
  });

  test("P0.1: resolves identically whether provided FileArtifact array or precomputed ReadonlySet", (): void => {
    const resolver = new ModuleResolver({ baseUrl: "src", paths: { "@/*": ["*"] } });
    const fileSet = new Set(files.map((file) => file.path));

    const arrayResult1 = resolver.resolve("src/api.js", "./billing", files);
    const setResult1 = resolver.resolve("src/api.js", "./billing", fileSet);
    expect(arrayResult1).toEqual(setResult1);

    const arrayResult2 = resolver.resolve("src/api.js", "@/billing", files);
    const setResult2 = resolver.resolve("src/api.js", "@/billing", fileSet);
    expect(arrayResult2).toEqual(setResult2);

    const arrayResult3 = resolver.resolve("src/api.js", "./missing", files);
    const setResult3 = resolver.resolve("src/api.js", "./missing", fileSet);
    expect(arrayResult3).toEqual(setResult3);
  });

  test("P0.1: enforces strict repository isolation without cross-repository cache contamination", (): void => {
    const resolver = new ModuleResolver();
    const repoAFiles: readonly FileArtifact[] = [
      { id: "app-a", path: "src/app.js", language: "javascript", size: 1 },
      { id: "auth-a", path: "src/auth.js", language: "javascript", size: 1 },
    ];
    const repoBFiles: readonly FileArtifact[] = [
      { id: "app-b", path: "src/app.js", language: "javascript", size: 1 },
      { id: "billing-b", path: "src/billing.js", language: "javascript", size: 1 },
    ];

    // Repo A has auth, does not have billing
    expect(resolver.resolve("src/app.js", "./auth", repoAFiles).resolvedPath).toBe("src/auth.js");
    expect(resolver.resolve("src/app.js", "./billing", repoAFiles).resolvedPath).toBeNull();

    // Repo B has billing, does not have auth
    expect(resolver.resolve("src/app.js", "./billing", repoBFiles).resolvedPath).toBe("src/billing.js");
    expect(resolver.resolve("src/app.js", "./auth", repoBFiles).resolvedPath).toBeNull();

    // Interleaved resolution on same resolver instance retains clean isolation
    expect(resolver.resolve("src/app.js", "./auth", repoAFiles).resolvedPath).toBe("src/auth.js");
    expect(resolver.resolve("src/app.js", "./billing", repoBFiles).resolvedPath).toBe("src/billing.js");
  });

  test("P0.1: reuses cached lookup across repeated resolutions without behavioral drift", (): void => {
    const resolver = new ModuleResolver({ baseUrl: "src", paths: { "@/*": ["*"] } });

    // Repeated resolution of many imports on the same files collection
    for (let i = 0; i < 500; i++) {
      const resBilling = resolver.resolve("src/api.js", "./billing", files);
      expect(resBilling.resolvedPath).toBe("src/billing.js");

      const resAlias = resolver.resolve("src/api.js", "@/utils", files);
      expect(resAlias.resolvedPath).toBe("src/utils/index.js");

      const resUnresolved = resolver.resolve("src/api.js", "non-existent-pkg", files);
      expect(resUnresolved.resolvedPath).toBeNull();
    }
  });

  describe("F-008: Cyclic / Path-based Dependency Resolution Integrity", () => {
    test("resolves specifiers with backslashes and redundant relative segments to canonical POSIX paths", (): void => {
      const resolver = new ModuleResolver();
      const lookupFiles: readonly FileArtifact[] = [
        { id: "billing", path: "src/billing.js", language: "javascript", size: 1 },
        { id: "barrel", path: "src/utils/index.js", language: "javascript", size: 1 },
      ];

      expect(resolver.resolve("src/api.js", ".\\billing", lookupFiles).resolvedPath).toBe("src/billing.js");
      expect(resolver.resolve("src/api.js", "./sub/../billing", lookupFiles).resolvedPath).toBe("src/billing.js");
      expect(resolver.resolve("src/services/api.js", "../billing", lookupFiles).resolvedPath).toBe("src/billing.js");
      expect(resolver.resolve("src/api.js", "./utils/", lookupFiles).resolvedPath).toBe("src/utils/index.js");
    });

    test("resolves self-import cycles deterministically", async (): Promise<void> => {
      const parser = new JavaScriptParser();
      const extractor = new JavaScriptSymbolExtractor();
      const selfFiles = [{ id: "self", path: "src/self.js", language: "javascript", size: 1 }] as const;
      const selfAst = (await parser.parse({ file: selfFiles[0], source: 'import self from "./self"; export default self;' })).result;
      const graph = new DeterministicDependencyGraphBuilder().build([extractor.extract(selfAst)], selfFiles);

      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]?.sourceFilePath).toBe("src/self.js");
      expect(graph.edges[0]?.targetFilePath).toBe("src/self.js");
      expect(graph.cycles).toEqual([["src/self.js", "src/self.js"]]);
    });

    test("resolves multi-node 3-file and 4-file cycles with canonical rotation order", async (): Promise<void> => {
      const parser = new JavaScriptParser();
      const extractor = new JavaScriptSymbolExtractor();
      const cycleFiles = [
        { id: "a", path: "src/a.js", language: "javascript", size: 1 },
        { id: "b", path: "src/b.js", language: "javascript", size: 1 },
        { id: "c", path: "src/c.js", language: "javascript", size: 1 },
      ] as const;

      const aAst = (await parser.parse({ file: cycleFiles[0], source: 'import b from "./b"; export default 1;' })).result;
      const bAst = (await parser.parse({ file: cycleFiles[1], source: 'import c from "./c"; export default 2;' })).result;
      const cAst = (await parser.parse({ file: cycleFiles[2], source: 'import a from "./a"; export default 3;' })).result;

      const graph = new DeterministicDependencyGraphBuilder().build(
        [extractor.extract(aAst), extractor.extract(bAst), extractor.extract(cAst)],
        cycleFiles,
      );

      expect(graph.edges).toHaveLength(3);
      expect(graph.cycles).toEqual([["src/a.js", "src/b.js", "src/c.js", "src/a.js"]]);
    });

    test("detects disconnected multiple cycles independently", async (): Promise<void> => {
      const parser = new JavaScriptParser();
      const extractor = new JavaScriptSymbolExtractor();
      const quadFiles = [
        { id: "a", path: "src/a.js", language: "javascript", size: 1 },
        { id: "b", path: "src/b.js", language: "javascript", size: 1 },
        { id: "c", path: "src/c.js", language: "javascript", size: 1 },
        { id: "d", path: "src/d.js", language: "javascript", size: 1 },
      ] as const;

      const aAst = (await parser.parse({ file: quadFiles[0], source: 'import b from "./b"; export default 1;' })).result;
      const bAst = (await parser.parse({ file: quadFiles[1], source: 'import a from "./a"; export default 2;' })).result;
      const cAst = (await parser.parse({ file: quadFiles[2], source: 'import d from "./d"; export default 3;' })).result;
      const dAst = (await parser.parse({ file: quadFiles[3], source: 'import c from "./c"; export default 4;' })).result;

      const graph = new DeterministicDependencyGraphBuilder().build(
        [extractor.extract(aAst), extractor.extract(bAst), extractor.extract(cAst), extractor.extract(dAst)],
        quadFiles,
      );

      expect(graph.edges).toHaveLength(4);
      expect(graph.cycles).toEqual([
        ["src/a.js", "src/b.js", "src/a.js"],
        ["src/c.js", "src/d.js", "src/c.js"],
      ]);
    });

    test("does not fabricate edges for circular re-export chains without a base definition", async (): Promise<void> => {
      const parser = new JavaScriptParser();
      const extractor = new JavaScriptSymbolExtractor();
      const chainFiles = [
        { id: "a", path: "src/a.js", language: "javascript", size: 1 },
        { id: "b", path: "src/b.js", language: "javascript", size: 1 },
        { id: "c", path: "src/c.js", language: "javascript", size: 1 },
      ] as const;

      const aAst = (await parser.parse({ file: chainFiles[0], source: 'export { missingSymbol } from "./b";' })).result;
      const bAst = (await parser.parse({ file: chainFiles[1], source: 'export { missingSymbol } from "./a";' })).result;
      const cAst = (await parser.parse({ file: chainFiles[2], source: 'import { missingSymbol } from "./a";' })).result;

      const graph = new DeterministicDependencyGraphBuilder().build(
        [extractor.extract(aAst), extractor.extract(bAst), extractor.extract(cAst)],
        chainFiles,
      );

      // Unresolvable circular re-export loop without base definition must produce no edge from c
      expect(graph.edges.filter((e) => e.sourceFilePath === "src/c.js")).toHaveLength(0);
    });

    test("resolves re-export chain to concrete definition across multiple hops", async (): Promise<void> => {
      const parser = new JavaScriptParser();
      const extractor = new JavaScriptSymbolExtractor();
      const chainFiles = [
        { id: "a", path: "src/a.js", language: "javascript", size: 1 },
        { id: "b", path: "src/b.js", language: "javascript", size: 1 },
        { id: "c", path: "src/c.js", language: "javascript", size: 1 },
        { id: "app", path: "src/app.js", language: "javascript", size: 1 },
      ] as const;

      const aAst = (await parser.parse({ file: chainFiles[0], source: 'export { foo } from "./b";' })).result;
      const bAst = (await parser.parse({ file: chainFiles[1], source: 'export { foo } from "./c";' })).result;
      const cAst = (await parser.parse({ file: chainFiles[2], source: "export function foo() {}" })).result;
      const appAst = (await parser.parse({ file: chainFiles[3], source: 'import { foo } from "./a";' })).result;

      const graph = new DeterministicDependencyGraphBuilder().build(
        [extractor.extract(aAst), extractor.extract(bAst), extractor.extract(cAst), extractor.extract(appAst)],
        chainFiles,
      );

      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]?.sourceFilePath).toBe("src/app.js");
      expect(graph.edges[0]?.targetFilePath).toBe("src/c.js");
    });

    test("resolves ReadonlySet known paths with Windows backslashes and dot segments", (): void => {
      const resolver = new ModuleResolver();

      // Finding #2A: ReadonlySet with Windows backslashes
      expect(resolver.resolve("src/api.js", "./billing", new Set(["src\\billing.js"])).resolvedPath).toBe("src/billing.js");

      // Finding #2B: ReadonlySet with dot segments
      expect(resolver.resolve("src/api.js", "./billing", new Set(["src/sub/../billing.js"])).resolvedPath).toBe("src/billing.js");

      // Finding #2D: Mixed separator and dot segments
      expect(resolver.resolve("src/api.js", "./billing", new Set(["src\\sub\\..\\billing.js"])).resolvedPath).toBe("src/billing.js");

      // Finding #2E: Canonical identity consistency across all equivalent representations
      const equivalentForms = [
        "src/billing.js",
        "src/./billing.js",
        "src/sub/../billing.js",
        "src\\billing.js",
        "src\\sub\\..\\billing.js",
      ];
      for (const form of equivalentForms) {
        expect(resolver.resolve("src/api.js", "./billing", new Set([form])).resolvedPath).toBe("src/billing.js");
      }
    });

    test("constructs graph edges when SymbolTable filePath contains dot segments or Windows backslashes", async (): Promise<void> => {
      const parser = new JavaScriptParser();
      const extractor = new JavaScriptSymbolExtractor();
      const files = [
        { id: "api", path: "src/api.js", language: "javascript", size: 1 },
        { id: "billing", path: "src/billing.js", language: "javascript", size: 1 },
      ] as const;

      const apiAst = (await parser.parse({ file: files[0], source: 'import billing from "./billing"; export default billing;' })).result;
      const billingAst = (await parser.parse({ file: files[1], source: "export default 42;" })).result;

      const apiTable = extractor.extract(apiAst);
      const billingTable = extractor.extract(billingAst);

      // Finding #1: SymbolTable.filePath containing unnormalized dot segments or backslashes
      const unnormalizedBillingTable = {
        ...billingTable,
        filePath: "src\\sub\\..\\billing.js",
      };

      const graph = new DeterministicDependencyGraphBuilder().build([apiTable, unnormalizedBillingTable], files);

      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]?.sourceFilePath).toBe("src/api.js");
      expect(graph.edges[0]?.targetFilePath).toBe("src/billing.js");
      expect(graph.nodes.some((node) => node.filePath === "src/billing.js")).toBeTrue();
    });
  });
});
