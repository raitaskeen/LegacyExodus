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

    expect(barrel.symbols.find((symbol) => symbol.kind === "export")?.sourceSymbolName).toBe("*");
    expect(graph.edges[0]?.targetFilePath).toBe("src/services/auth.js");
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
});
