import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { FileArtifact } from "@contracts/discovery";
import type { LegacyExodusEngine } from "@core/engine";
import { AnalyzeProjectHandler } from "@core/orchestration/command-handler";
import { DiscoveryEngine } from "@discovery/index";
import { ModuleResolver, type ModuleResolutionOptions } from "@graph/index";
import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";
import { createLegacyExodusEngine } from "@runtime/composition/services";
import { JavaScriptSymbolExtractor } from "@symbols/index";

// The loader is imported lazily so that, on a revision without it, only the loader tests fail
// (module not found) while the resolver tests still fail on their own assertions.
type TsConfigLoader = typeof import("@graph/tsconfig-loader");
const loader = (): Promise<TsConfigLoader> => import("@graph/tsconfig-loader");

function known(...paths: readonly string[]): readonly FileArtifact[] {
  return paths.map((path, index) => ({
    id: `f${index}`,
    path,
    language: /\.[cm]?tsx?$/.test(path) ? "typescript" : "javascript",
    size: 1,
  }));
}

function resolveWith(options: ModuleResolutionOptions, importer: string, specifier: string, ...files: readonly string[]): string | null {
  return new ModuleResolver(options).resolve(importer, specifier, known(...files)).resolvedPath;
}

// ---------------------------------------------------------------------------------------------
// JSONC
// ---------------------------------------------------------------------------------------------

describe("parseJsonc", () => {
  async function parse(text: string): Promise<unknown> {
    const { parseJsonc } = await loader();
    const result = parseJsonc(text);
    if (!result.ok) throw new Error(`unexpected parse failure: ${result.message}`);
    return result.value;
  }
  async function failure(text: string): Promise<string> {
    const { parseJsonc } = await loader();
    const result = parseJsonc(text);
    if (result.ok) throw new Error("expected a parse failure");
    return result.message;
  }

  test("accepts line and block comments wherever whitespace is allowed", async () => {
    const text = [
      "// leading",
      "{ /* before key */ \"a\" /* after key */ : /* before value */ 1, // trailing line",
      "  \"b\": [1, /* inside array */ 2],",
      "  /* multi",
      "     line */",
      "  \"c\": true",
      "} // final comment without newline",
    ].join("\n");
    expect(await parse(text)).toEqual({ a: 1, b: [1, 2], c: true });
  });

  test("accepts trailing commas before } and ] and nowhere else", async () => {
    expect(await parse("{\"a\": [1, 2,], \"b\": {\"c\": 3,},}")).toEqual({ a: [1, 2], b: { c: 3 } });
    expect(await parse("[1, 2, /* c */ ]")).toEqual([1, 2]);
    for (const invalid of ["{,}", "[,]", "{\"a\":1,,}", "[1,,2]", "{\"a\":,}", "{\"a\" 1}", "[1 2]"]) {
      expect(await failure(invalid)).toBeString();
    }
  });

  test("keeps comment-like text inside strings", async () => {
    const text = "{ \"url\": \"http://example.com/*x*/\", \"glob\": \"src/**/*.ts\", \"line\": \"// not a comment\", \"block\": \"/* nor this */\" }";
    expect(await parse(text)).toEqual({
      url: "http://example.com/*x*/",
      glob: "src/**/*.ts",
      line: "// not a comment",
      block: "/* nor this */",
    });
  });

  test("does not end a string at an escaped quote or treat an escaped slash as a comment", async () => {
    expect(await parse("{\"a\": \"say \\\"hi\\\" // still string\", \"b\": \"\\/\\/x\"}")).toEqual({ a: "say \"hi\" // still string", b: "//x" });
  });

  test("decodes the JSON escapes", async () => {
    expect(await parse("\"\\u0041\\n\\t\\\\\\/\\b\\f\\r\"")).toBe("A\n\t\\/\b\f\r");
  });

  test("ignores a leading byte order mark", async () => {
    expect(await parse("\uFEFF{\"a\": 1}")).toEqual({ a: 1 });
  });

  test("parses numbers, literals and nesting like JSON", async () => {
    expect(await parse("[-1.5e3, 0, 10, true, false, null, \"x\", {}, []]")).toEqual([-1500, 0, 10, true, false, null, "x", {}, []]);
    for (const invalid of ["[01]", "[.5]", "[1.]", "[+1]", "[1e]", "[tru]", "[nul]"]) {
      expect(await failure(invalid)).toBeString();
    }
  });

  test("rejects unterminated comments and strings, trailing content and empty input", async () => {
    for (const invalid of ["{ /* never closed", "{\"a\": \"open", "{\"a\": \"line\nbreak\"}", "{} {}", "{} x", "", "   ", "// only a comment", "{\"a\": 1", "[1, 2", "{\"a\": \"\\u12G4\"}", "{\"a\": \"\\q\"}"]) {
      expect(await failure(invalid)).toBeString();
    }
  });

  test("reports the failure position without echoing the source text", async () => {
    const { parseJsonc } = await loader();
    const result = parseJsonc("{\"secret\": nope}");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.offset).toBe(11);
      expect(result.message).not.toContain("secret");
      expect(result.message).not.toContain("nope");
    }
  });

  test("a __proto__ key is data and never changes the prototype", async () => {
    const value = (await parse("{\"__proto__\": {\"polluted\": true}, \"ok\": 1}")) as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(["__proto__", "ok"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(value)).toBeNull();
  });

  test("the last duplicate key wins, as in JSON.parse", async () => {
    expect(await parse("{\"a\": 1, \"a\": 2}")).toEqual({ a: 2 });
  });

  test("refuses pathological nesting instead of overflowing the stack", async () => {
    expect(await failure("[".repeat(10_000) + "]".repeat(10_000))).toContain("deep");
  });
});

// ---------------------------------------------------------------------------------------------
// tsconfig loading
// ---------------------------------------------------------------------------------------------

describe("loadTsConfigResolution", () => {
  const roots: string[] = [];
  afterAll(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });

  /** Lays out `files` in a fresh temporary directory; the project root is `<temp>/project`. */
  async function project(files: Readonly<Record<string, string>>): Promise<string> {
    const base = await mkdtemp(join(tmpdir(), "lx-tsconfig-"));
    roots.push(base);
    const root = join(base, "project");
    await mkdir(root, { recursive: true });
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(base, path)), { recursive: true });
      await writeFile(join(base, path), content);
    }
    return root;
  }
  async function load(root: string) {
    return (await loader()).loadTsConfigResolution(root);
  }
  const codes = (result: { readonly diagnostics: readonly { readonly code: string }[] }): readonly string[] => result.diagnostics.map((d) => d.code);

  test("reads a tsc --init style file with comments and trailing commas", async () => {
    const root = await project({
      "project/tsconfig.json": [
        "{",
        "  /* Visit https://aka.ms/tsconfig to read more about this file */",
        "  \"compilerOptions\": {",
        "    // \"baseUrl\": \"./disabled\",",
        "    \"baseUrl\": \".\", /* base */",
        "    \"paths\": { \"@lib/*\": [\"src/*\",], }, // alias",
        "  },",
        "}",
      ].join("\n"),
    });
    const result = await load(root);
    expect(result.options).toEqual({ baseUrl: ".", paths: { "@lib/*": ["src/*"] } });
    expect(result.diagnostics).toEqual([]);
  });

  test("reads a file that begins with a byte order mark", async () => {
    const root = await project({ "project/tsconfig.json": "\uFEFF{\"compilerOptions\":{\"baseUrl\":\"src\"}}" });
    expect((await load(root)).options).toEqual({ baseUrl: "src" });
  });

  test("a project without tsconfig.json or jsconfig.json has no aliases and no diagnostics", async () => {
    const root = await project({ "project/index.js": "" });
    const result = await load(root);
    expect(result.options).toEqual({});
    expect(result.diagnostics).toEqual([]);
  });

  test("falls back to jsconfig.json only when tsconfig.json is absent", async () => {
    const onlyJs = await project({ "project/jsconfig.json": "{ // js\n \"compilerOptions\": { \"baseUrl\": \"app\", }, }" });
    expect((await load(onlyJs)).options).toEqual({ baseUrl: "app" });

    const both = await project({
      "project/jsconfig.json": "{\"compilerOptions\":{\"baseUrl\":\"js\"}}",
      "project/tsconfig.json": "{\"compilerOptions\":{\"baseUrl\":\"ts\"}}",
    });
    expect((await load(both)).options).toEqual({ baseUrl: "ts" });

    const brokenTs = await project({
      "project/jsconfig.json": "{\"compilerOptions\":{\"baseUrl\":\"js\"}}",
      "project/tsconfig.json": "{ \"compilerOptions\": ",
    });
    const result = await load(brokenTs);
    expect(result.options).toEqual({});
    expect(codes(result)).toEqual(["TSCONFIG_PARSE_ERROR"]);
  });

  test("a broken root config yields no aliases and a diagnostic, never an exception", async () => {
    const root = await project({ "project/tsconfig.json": "{ \"compilerOptions\": { \"paths\": { \"@/*\": [\"src/*\"] } } " });
    const result = await load(root);
    expect(result.options).toEqual({});
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: "TSCONFIG_PARSE_ERROR", file: "tsconfig.json" });
    expect(result.diagnostics[0]?.message).toBeString();
  });

  test("a root value that is not an object, and a directory named tsconfig.json, are diagnosed", async () => {
    const array = await project({ "project/tsconfig.json": "[1, 2]" });
    const arrayResult = await load(array);
    expect(arrayResult.options).toEqual({});
    expect(codes(arrayResult)).toEqual(["TSCONFIG_INVALID_SHAPE"]);

    const directory = await project({ "project/tsconfig.json/placeholder": "" });
    const directoryResult = await load(directory);
    expect(directoryResult.options).toEqual({});
    expect(codes(directoryResult)).toEqual(["TSCONFIG_READ_ERROR"]);
  });

  test("ignores invalid compilerOptions members individually and says so", async () => {
    const root = await project({
      "project/tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: 7, paths: { "@ok/*": ["ok/*"], "@bad": "not-an-array", "@mixed/*": ["fine/*", 3], "@empty/*": [] } },
      }),
    });
    const result = await load(root);
    expect(result.options).toEqual({ paths: { "@ok/*": ["ok/*"] } });
    expect(new Set(codes(result))).toEqual(new Set(["TSCONFIG_INVALID_SHAPE"]));
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(3);
  });

  // A baseUrl on another drive has no relative spelling; only Windows has drives, so elsewhere this is skipped.
  test.skipIf(process.platform !== "win32")("a baseUrl on another drive is reported instead of being turned into a wrong alias", async () => {
    const base = await mkdtemp(join(tmpdir(), "lx-tsconfig-"));
    roots.push(base);
    const root = join(base, "project");
    await mkdir(root, { recursive: true });
    const otherDrive = root.charAt(0).toUpperCase() === "Z" ? "Y" : "Z";
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: `${otherDrive}:/elsewhere`, paths: { "@/*": ["src/*"] } } }));
    const result = await load(root);
    expect(result.options).toEqual({});
    expect(codes(result)).toEqual(["TSCONFIG_INVALID_SHAPE"]);
  });

  test("follows a string extends; the child overrides the base option by option", async () => {
    const root = await project({
      "project/tsconfig.base.json": "{ \"compilerOptions\": { \"baseUrl\": \"base\", \"paths\": { \"@a/*\": [\"a/*\"] } } }",
      "project/tsconfig.json": "{ \"extends\": \"./tsconfig.base\", \"compilerOptions\": { \"baseUrl\": \"child\" } }",
    });
    const result = await load(root);
    // baseUrl comes from the child; paths are inherited and, with a baseUrl in effect, stay relative to it.
    expect(result.options).toEqual({ baseUrl: "child", paths: { "@a/*": ["a/*"] } });
    expect(result.diagnostics).toEqual([]);
  });

  test("a child paths replaces the base paths instead of merging with it", async () => {
    const root = await project({
      "project/base.json": "{ \"compilerOptions\": { \"paths\": { \"@base/*\": [\"b/*\"], \"@shared/*\": [\"b/shared/*\"] } } }",
      "project/tsconfig.json": "{ \"extends\": \"./base.json\", \"compilerOptions\": { \"paths\": { \"@shared/*\": [\"c/*\"] } } }",
    });
    expect((await load(root)).options).toEqual({ paths: { "@shared/*": ["c/*"] } });
  });

  test("an extends array applies in order: later entries override earlier ones, the child overrides all", async () => {
    const root = await project({
      "project/one.json": "{ \"compilerOptions\": { \"baseUrl\": \"one\", \"paths\": { \"@x/*\": [\"one/*\"] } } }",
      "project/two.json": "{ \"compilerOptions\": { \"baseUrl\": \"two\" } }",
      "project/tsconfig.json": "{ \"extends\": [\"./one.json\", \"./two.json\"] }",
    });
    expect((await load(root)).options).toEqual({ baseUrl: "two", paths: { "@x/*": ["one/*"] } });

    const childWins = await project({
      "project/one.json": "{ \"compilerOptions\": { \"baseUrl\": \"one\", \"paths\": { \"@x/*\": [\"one/*\"] } } }",
      "project/two.json": "{ \"compilerOptions\": { \"baseUrl\": \"two\" } }",
      "project/tsconfig.json": "{ \"extends\": [\"./one.json\", \"./two.json\"], \"compilerOptions\": { \"baseUrl\": \"mine\" } }",
    });
    expect((await load(childWins)).options).toEqual({ baseUrl: "mine", paths: { "@x/*": ["one/*"] } });
  });

  test("follows a chain of extends and resolves each path against the extending file", async () => {
    const root = await project({
      "project/configs/deep/leaf.json": "{ \"compilerOptions\": { \"baseUrl\": \"../../src\" } }",
      "project/configs/mid.json": "{ \"extends\": \"./deep/leaf.json\" }",
      "project/tsconfig.json": "{ \"extends\": \"./configs/mid\" }",
    });
    expect((await load(root)).options).toEqual({ baseUrl: "src" });
  });

  test("baseUrl is relative to the config that sets it, and paths follow the baseUrl in effect", async () => {
    const root = await project({
      "project/config/base.json": "{ \"compilerOptions\": { \"baseUrl\": \".\" } }",
      "project/tsconfig.json": "{ \"extends\": \"./config/base.json\", \"compilerOptions\": { \"paths\": { \"@/*\": [\"src/*\"] } } }",
    });
    // The base sets baseUrl "." relative to project/config, so paths targets resolve against project/config.
    expect((await load(root)).options).toEqual({ baseUrl: "config", paths: { "@/*": ["src/*"] } });
  });

  test("without a baseUrl, paths targets are relative to the config that defines paths", async () => {
    const root = await project({
      "project/config/base.json": "{ \"compilerOptions\": { \"paths\": { \"@x/*\": [\"./src/*\", \"../shared/*\"] } } }",
      "project/tsconfig.json": "{ \"extends\": \"./config/base.json\" }",
      "project/own/tsconfig.json": "{ \"compilerOptions\": { \"paths\": { \"@own/*\": [\"lib/*\"] } } }",
    });
    expect((await load(root)).options).toEqual({ paths: { "@x/*": ["config/src/*", "shared/*"] } });
    expect((await load(join(root, "own"))).options).toEqual({ paths: { "@own/*": ["lib/*"] } });
  });

  test("a baseUrl that appears only in a descendant still governs paths defined by an ancestor", async () => {
    const root = await project({
      "project/config/base.json": "{ \"compilerOptions\": { \"paths\": { \"@x/*\": [\"x/*\"] } } }",
      "project/tsconfig.json": "{ \"extends\": \"./config/base.json\", \"compilerOptions\": { \"baseUrl\": \"src\" } }",
    });
    expect((await load(root)).options).toEqual({ baseUrl: "src", paths: { "@x/*": ["x/*"] } });
  });

  test("keeps the declaration order of paths patterns and of their targets", async () => {
    const root = await project({
      "project/tsconfig.json": "{ \"compilerOptions\": { \"paths\": { \"z/*\": [\"zed/*\", \"alpha/*\"], \"a/*\": [\"b/*\", \"a/*\"] } } }",
    });
    const options = (await load(root)).options;
    expect(Object.keys(options.paths ?? {})).toEqual(["z/*", "a/*"]);
    expect(options.paths?.["z/*"]).toEqual(["zed/*", "alpha/*"]);
    expect(options.paths?.["a/*"]).toEqual(["b/*", "a/*"]);
  });

  test("substitutes ${configDir} with the directory of the root config", async () => {
    const root = await project({
      "project/config/base.json": "{ \"compilerOptions\": { \"baseUrl\": \"${configDir}/src\", \"paths\": { \"@/*\": [\"${configDir}/lib/*\"] } } }",
      "project/tsconfig.json": "{ \"extends\": \"./config/base.json\" }",
    });
    expect((await load(root)).options).toEqual({ baseUrl: "src", paths: { "@/*": ["../lib/*"] } });
  });

  test("normalizes backslashes written by Windows authors", async () => {
    const root = await project({
      "project/tsconfig.json": "{ \"compilerOptions\": { \"baseUrl\": \"src\\\\app\", \"paths\": { \"@/*\": [\"ui\\\\*\"] } } }",
    });
    expect((await load(root)).options).toEqual({ baseUrl: "src/app", paths: { "@/*": ["ui/*"] } });
  });

  test("detects extends cycles, keeps the rest of the configuration and reports the cycle", async () => {
    const root = await project({
      "project/a.json": "{ \"extends\": \"./b.json\", \"compilerOptions\": { \"baseUrl\": \"from-a\" } }",
      "project/b.json": "{ \"extends\": \"./a.json\", \"compilerOptions\": { \"paths\": { \"@b/*\": [\"b/*\"] } } }",
      "project/tsconfig.json": "{ \"extends\": \"./a.json\" }",
      "project/self/tsconfig.json": "{ \"extends\": \"./tsconfig.json\", \"compilerOptions\": { \"baseUrl\": \"self\" } }",
    });
    const result = await load(root);
    expect(codes(result)).toEqual(["TSCONFIG_EXTENDS_CYCLE"]);
    expect(result.options).toEqual({ baseUrl: "from-a", paths: { "@b/*": ["b/*"] } });

    const self = await load(join(root, "self"));
    expect(codes(self)).toEqual(["TSCONFIG_EXTENDS_CYCLE"]);
    expect(self.options).toEqual({ baseUrl: "self" });
  });

  test("a diamond (the same base reached twice) is not a cycle", async () => {
    const root = await project({
      "project/shared.json": "{ \"compilerOptions\": { \"baseUrl\": \"shared\" } }",
      "project/left.json": "{ \"extends\": \"./shared.json\" }",
      "project/right.json": "{ \"extends\": \"./shared.json\" }",
      "project/tsconfig.json": "{ \"extends\": [\"./left.json\", \"./right.json\"] }",
    });
    const result = await load(root);
    expect(result.diagnostics).toEqual([]);
    expect(result.options).toEqual({ baseUrl: "shared" });
  });

  test("a package extends that is not installed is skipped, recorded as unresolved and does not stop loading", async () => {
    const root = await project({
      "project/tsconfig.json": "{ \"extends\": [\"@tsconfig/node18/tsconfig.json\", \"./local.json\"], \"compilerOptions\": { \"paths\": { \"@/*\": [\"src/*\"] } } }",
      "project/local.json": "{ \"compilerOptions\": { \"baseUrl\": \"lib\" } }",
    });
    const result = await load(root);
    expect(codes(result)).toEqual(["TSCONFIG_EXTENDS_UNRESOLVED"]);
    expect(result.diagnostics[0]?.message).toContain("@tsconfig/node18/tsconfig.json");
    expect(result.options).toEqual({ baseUrl: "lib", paths: { "@/*": ["src/*"] } });
  });

  test("resolves a package extends through node_modules inside the project", async () => {
    const root = await project({
      "project/node_modules/@tsconfig/node18/tsconfig.json": "{ // shipped config\n \"compilerOptions\": { \"baseUrl\": \"./pkg-base\", }, }",
      "project/tsconfig.json": "{ \"extends\": \"@tsconfig/node18/tsconfig.json\" }",
    });
    const result = await load(root);
    expect(result.diagnostics).toEqual([]);
    expect(result.options).toEqual({ baseUrl: "node_modules/@tsconfig/node18/pkg-base" });
  });

  test("a package extends may omit .json or name only the package directory", async () => {
    const root = await project({
      "project/node_modules/some-config/base.json": "{ \"compilerOptions\": { \"paths\": { \"@p/*\": [\"p/*\"] } } }",
      "project/node_modules/dir-config/tsconfig.json": "{ \"compilerOptions\": { \"baseUrl\": \"dir\" } }",
      "project/tsconfig.json": "{ \"extends\": [\"some-config/base\", \"dir-config\"] }",
    });
    const result = await load(root);
    expect(result.diagnostics).toEqual([]);
    expect(result.options).toEqual({ baseUrl: "node_modules/dir-config/dir", paths: { "@p/*": ["p/*"] } });
  });

  test("a package extends is looked up from the extending file's directory upward, within the project", async () => {
    const root = await project({
      "project/node_modules/cfg/tsconfig.json": "{ \"compilerOptions\": { \"baseUrl\": \"up\" } }",
      "project/packages/app/node_modules/near/tsconfig.json": "{ \"compilerOptions\": { \"paths\": { \"@near/*\": [\"n/*\"] } } }",
      "project/packages/app/tsconfig.json": "{ \"extends\": [\"cfg\", \"near\"] }",
      "project/tsconfig.json": "{ \"extends\": \"./packages/app/tsconfig.json\" }",
    });
    const result = await load(root);
    expect(result.diagnostics).toEqual([]);
    expect(result.options).toEqual({ baseUrl: "node_modules/cfg/up", paths: { "@near/*": ["n/*"] } });
  });

  test("never follows an extends outside the project root", async () => {
    const root = await project({
      "outside.json": "{ \"compilerOptions\": { \"baseUrl\": \"outside\" } }",
      "project/tsconfig.json": "{ \"extends\": \"../outside.json\", \"compilerOptions\": { \"paths\": { \"@/*\": [\"src/*\"] } } }",
    });
    const result = await load(root);
    expect(codes(result)).toEqual(["TSCONFIG_EXTENDS_OUTSIDE_PROJECT"]);
    expect(result.options).toEqual({ paths: { "@/*": ["src/*"] } });
  });

  test("never follows a symlink that leads out of the project", async () => {
    const root = await project({
      "outside/real.json": "{ \"compilerOptions\": { \"baseUrl\": \"leaked\" } }",
      "project/placeholder.txt": "",
    });
    try {
      await symlink(join(root, "..", "outside"), join(root, "linked"), "junction");
    } catch {
      return; // The platform refuses to create links here; the lexical test above still guards the boundary.
    }
    await writeFile(join(root, "tsconfig.json"), "{ \"extends\": \"./linked/real.json\" }");
    const result = await load(root);
    expect(result.options).toEqual({});
    expect(codes(result)).toEqual(["TSCONFIG_EXTENDS_OUTSIDE_PROJECT"]);
  });

  test("a broken base is skipped like an unresolved one; invalid extends members are diagnosed", async () => {
    const root = await project({
      "project/broken.json": "{ \"compilerOptions\": ",
      "project/tsconfig.json": "{ \"extends\": [\"./broken.json\", 5], \"compilerOptions\": { \"baseUrl\": \"src\" } }",
    });
    const result = await load(root);
    expect(result.options).toEqual({ baseUrl: "src" });
    expect(new Set(codes(result))).toEqual(new Set(["TSCONFIG_PARSE_ERROR", "TSCONFIG_INVALID_SHAPE"]));
  });

  test("diagnostics name config files by project-relative POSIX paths and never echo file content", async () => {
    const root = await project({
      "project/configs/bad.json": "{ \"supersecret\": nope }",
      "project/tsconfig.json": "{ \"extends\": \"./configs/bad.json\" }",
    });
    const result = await load(root);
    expect(result.diagnostics.map((d) => d.file)).toEqual(["configs/bad.json"]);
    expect(JSON.stringify(result.diagnostics)).not.toContain("supersecret");
  });

  test("an excessively long extends chain stops with a diagnostic", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 80; index += 1) {
      files[`project/c${index}.json`] = `{ "extends": "./c${index + 1}.json" }`;
    }
    files["project/c80.json"] = "{ \"compilerOptions\": { \"baseUrl\": \"end\" } }";
    files["project/tsconfig.json"] = "{ \"extends\": \"./c0.json\", \"compilerOptions\": { \"paths\": { \"@/*\": [\"src/*\"] } } }";
    const result = await load(await project(files));
    expect(codes(result)).toContain("TSCONFIG_EXTENDS_TOO_DEEP");
    expect(result.options.paths).toEqual({ "@/*": ["src/*"] });
  });
});

// ---------------------------------------------------------------------------------------------
// Relative specifiers and TypeScript extension substitution
// ---------------------------------------------------------------------------------------------

describe("ModuleResolver relative specifiers", () => {
  test("a TypeScript importer resolves ./a.js to the TypeScript source", () => {
    expect(resolveWith({}, "src/b.ts", "./a.js", "src/a.ts", "src/b.ts")).toBe("src/a.ts");
    expect(resolveWith({}, "src/b.tsx", "./a.js", "src/a.tsx", "src/b.tsx")).toBe("src/a.tsx");
    expect(resolveWith({}, "src/b.mts", "./a.js", "src/a.d.ts", "src/b.mts")).toBe("src/a.d.ts");
    expect(resolveWith({}, "src/b.cts", "./a.js", "src/a.ts")).toBe("src/a.ts");
  });

  test("when both exist, a TypeScript importer prefers the source and a JavaScript importer the literal file", () => {
    const files = ["src/a.js", "src/a.ts", "src/importer.ts", "src/importer.js"] as const;
    expect(resolveWith({}, "src/importer.ts", "./a.js", ...files)).toBe("src/a.ts");
    expect(resolveWith({}, "src/importer.js", "./a.js", ...files)).toBe("src/a.js");
  });

  test("falls back to the literal file for a TypeScript importer and to the TypeScript source for a JavaScript importer", () => {
    expect(resolveWith({}, "src/importer.ts", "./a.js", "src/a.js")).toBe("src/a.js");
    expect(resolveWith({}, "src/importer.js", "./a.js", "src/a.ts")).toBe("src/a.ts");
  });

  test("tries .ts, then .tsx, then .d.ts for a .js specifier", () => {
    expect(resolveWith({}, "src/i.ts", "./a.js", "src/a.d.ts", "src/a.tsx", "src/a.ts")).toBe("src/a.ts");
    expect(resolveWith({}, "src/i.ts", "./a.js", "src/a.d.ts", "src/a.tsx")).toBe("src/a.tsx");
    expect(resolveWith({}, "src/i.ts", "./a.js", "src/a.d.ts")).toBe("src/a.d.ts");
  });

  test("maps .jsx to .tsx, .mjs to .mts or .d.mts and .cjs to .cts or .d.cts", () => {
    expect(resolveWith({}, "src/i.tsx", "./view.jsx", "src/view.tsx")).toBe("src/view.tsx");
    expect(resolveWith({}, "src/i.mts", "./m.mjs", "src/m.mts")).toBe("src/m.mts");
    expect(resolveWith({}, "src/i.mts", "./m.mjs", "src/m.d.mts")).toBe("src/m.d.mts");
    expect(resolveWith({}, "src/i.cts", "./c.cjs", "src/c.cts")).toBe("src/c.cts");
    expect(resolveWith({}, "src/i.cts", "./c.cjs", "src/c.d.cts")).toBe("src/c.d.cts");
    expect(resolveWith({}, "src/i.js", "./m.mjs", "src/m.mts")).toBe("src/m.mts");
  });

  test("does not cross module kinds: .mjs never becomes .ts and .cjs never becomes .mts", () => {
    expect(resolveWith({}, "src/i.ts", "./m.mjs", "src/m.ts", "src/m.tsx", "src/m.d.ts")).toBeNull();
    expect(resolveWith({}, "src/i.ts", "./c.cjs", "src/c.mts", "src/c.ts")).toBeNull();
    expect(resolveWith({}, "src/i.ts", "./v.jsx", "src/v.ts")).toBeNull();
  });

  test("substitutes in parent directories and for directory-qualified specifiers", () => {
    expect(resolveWith({}, "src/deep/x.ts", "../util/a.js", "src/util/a.ts")).toBe("src/util/a.ts");
    expect(resolveWith({}, "src/x.ts", "./sub/dir/a.js", "src/sub/dir/a.ts")).toBe("src/sub/dir/a.ts");
  });

  test("keeps every existing extensionless candidate and adds .mts, .cts, .d.ts and index.d.ts", () => {
    for (const [file, expected] of [
      ["src/a.js", "src/a.js"], ["src/a.jsx", "src/a.jsx"], ["src/a.ts", "src/a.ts"], ["src/a.tsx", "src/a.tsx"],
      ["src/a.mjs", "src/a.mjs"], ["src/a.cjs", "src/a.cjs"], ["src/a.mts", "src/a.mts"], ["src/a.cts", "src/a.cts"],
      ["src/a.d.ts", "src/a.d.ts"], ["src/a/index.js", "src/a/index.js"], ["src/a/index.jsx", "src/a/index.jsx"],
      ["src/a/index.ts", "src/a/index.ts"], ["src/a/index.tsx", "src/a/index.tsx"], ["src/a/index.mjs", "src/a/index.mjs"],
      ["src/a/index.cjs", "src/a/index.cjs"], ["src/a/index.d.ts", "src/a/index.d.ts"],
    ] as const) {
      expect(resolveWith({}, "src/i.ts", "./a", file)).toBe(expected);
    }
  });

  test("keeps the established order among extensionless candidates", () => {
    expect(resolveWith({}, "src/i.ts", "./a", "src/a.ts", "src/a.js")).toBe("src/a.js");
    expect(resolveWith({}, "src/i.ts", "./a", "src/a.d.ts", "src/a/index.js")).toBe("src/a.d.ts");
    expect(resolveWith({}, "src/i.ts", "./a", "src/a/index.d.ts", "src/a/index.ts")).toBe("src/a/index.ts");
  });

  test("an exact path to an existing file still wins and nothing resolves outside the known file set", () => {
    expect(resolveWith({}, "src/i.ts", "./a.ts", "src/a.ts")).toBe("src/a.ts");
    expect(resolveWith({}, "src/i.ts", "./a.js", "src/other.ts")).toBeNull();
    expect(resolveWith({}, "src/i.ts", "./a.js")).toBeNull();
    expect(resolveWith({}, "src/i.ts", "./a.json", "src/a.ts")).toBeNull();
  });

  test("is independent of the order in which files were discovered", () => {
    const files = ["src/a.js", "src/a.ts", "src/a.d.ts", "src/a.tsx"] as const;
    const forward = resolveWith({}, "src/i.ts", "./a.js", ...files);
    const backward = resolveWith({}, "src/i.ts", "./a.js", ...[...files].reverse());
    expect(forward).toBe("src/a.ts");
    expect(backward).toBe(forward);
  });

  test("handles Windows separators and drive-letter casing together with substitution", () => {
    const resolver = new ModuleResolver();
    const files = known("C:/proj/src/a.ts");
    expect(resolver.resolve("c:\\proj\\src\\b.ts", ".\\a.js", files).resolvedPath).toBe("c:/proj/src/a.ts");
  });
});

// ---------------------------------------------------------------------------------------------
// paths precedence, baseUrl and bare packages
// ---------------------------------------------------------------------------------------------

describe("ModuleResolver non-relative specifiers", () => {
  test("a more specific pattern beats the generic @/* regardless of declaration or sort order", () => {
    const files = ["src/_internal/x.ts", "src/internal-v2/x.ts", "src/api.ts"] as const;
    const generic = ["src/*"];
    const specific = ["src/internal-v2/*"];
    for (const paths of [
      { "@/*": generic, "@/_internal/*": specific },
      { "@/_internal/*": specific, "@/*": generic },
    ]) {
      expect(resolveWith({ paths }, "src/i.ts", "@/_internal/x", ...files)).toBe("src/internal-v2/x.ts");
      expect(resolveWith({ paths }, "src/i.ts", "@/api", ...files)).toBe("src/api.ts");
    }
  });

  test("an exact pattern beats any wildcard pattern", () => {
    const files = ["src/core/index.ts", "src/lib/core.ts"] as const;
    for (const paths of [
      { "@lib/*": ["src/lib/*"], "@lib/core": ["src/core/index"] },
      { "@lib/core": ["src/core/index"], "@lib/*": ["src/lib/*"] },
    ]) {
      expect(resolveWith({ paths }, "src/i.ts", "@lib/core", ...files)).toBe("src/core/index.ts");
    }
  });

  test("the longest prefix wins among wildcard patterns; the lone * is the weakest", () => {
    const files = ["a/x.ts", "ab/x.ts", "abc/x.ts", "star/a/b/c/x.ts"] as const;
    const orders = [
      ["@/*", "@/b/*", "@/b/c/*", "*"],
      ["*", "@/b/c/*", "@/b/*", "@/*"],
    ] as const;
    const targets: Record<string, readonly string[]> = {
      "*": ["star/*"], "@/*": ["a/*"], "@/b/*": ["ab/*"], "@/b/c/*": ["abc/*"],
    };
    for (const order of orders) {
      const paths = Object.fromEntries(order.map((pattern) => [pattern, targets[pattern] ?? []]));
      expect(resolveWith({ paths }, "i.ts", "@/b/c/x", ...files)).toBe("abc/x.ts");
      expect(resolveWith({ paths }, "i.ts", "@/b/x", ...files)).toBe("ab/x.ts");
      expect(resolveWith({ paths }, "i.ts", "@/x", ...files)).toBe("a/x.ts");
      expect(resolveWith({ paths }, "i.ts", "a/b/c/x", ...files)).toBe("star/a/b/c/x.ts");
    }
  });

  test("patterns of equal prefix length are tried in declaration order", () => {
    // Both patterns have the prefix "@/" and both match "@/yx"; the first one declared wins.
    const files = ["one/yx.ts", "two/y.ts"] as const;
    expect(resolveWith({ paths: { "@/*": ["one/*"], "@/*x": ["two/*"] } }, "i.ts", "@/yx", ...files)).toBe("one/yx.ts");
    expect(resolveWith({ paths: { "@/*x": ["two/*"], "@/*": ["one/*"] } }, "i.ts", "@/yx", ...files)).toBe("two/y.ts");
  });

  test("targets are tried in their listed order, not in sorted order", () => {
    const files = ["a/f.ts", "z/f.ts"] as const;
    expect(resolveWith({ paths: { "@x/*": ["z/*", "a/*"] } }, "i.ts", "@x/f", ...files)).toBe("z/f.ts");
    expect(resolveWith({ paths: { "@x/*": ["a/*", "z/*"] } }, "i.ts", "@x/f", ...files)).toBe("a/f.ts");
    expect(resolveWith({ paths: { "@x/*": ["missing/*", "z/*"] } }, "i.ts", "@x/f", ...files)).toBe("z/f.ts");
  });

  test("only the best matching pattern is consulted; a failing specific pattern does not fall back to the generic one", () => {
    const paths = { "@/*": ["src/*"], "@/_internal/*": ["nowhere/*"] };
    expect(resolveWith({ paths }, "i.ts", "@/_internal/x", "src/_internal/x.ts")).toBeNull();
  });

  test("a wildcard pattern needs the whole prefix and suffix and does not overlap them", () => {
    const paths = { "a*a": ["m/*"], "icons/*.svg": ["assets/*.svg.ts"] };
    expect(resolveWith({ paths }, "i.ts", "a", "m/.ts", "m/index.ts")).toBeNull();
    expect(resolveWith({ paths }, "i.ts", "aXa", "m/X.ts")).toBe("m/X.ts");
    expect(resolveWith({ paths }, "i.ts", "icons/home.svg", "assets/home.svg.ts")).toBe("assets/home.svg.ts");
    expect(resolveWith({ paths }, "i.ts", "icons/home.png", "assets/home.png.ts")).toBeNull();
  });

  test("a matched fragment containing $ is inserted literally", () => {
    expect(resolveWith({ paths: { "@/*": ["src/*"] } }, "i.ts", "@/$&", "src/$&.ts")).toBe("src/$&.ts");
  });

  test("paths targets are joined with baseUrl and use the same candidates, including .js to .ts", () => {
    const options = { baseUrl: "pkg", paths: { "@lib/*": ["src/*"] } };
    expect(resolveWith(options, "pkg/i.ts", "@lib/a", "pkg/src/a.ts")).toBe("pkg/src/a.ts");
    expect(resolveWith(options, "pkg/i.ts", "@lib/a.js", "pkg/src/a.ts", "pkg/src/a.js")).toBe("pkg/src/a.ts");
    expect(resolveWith(options, "pkg/i.js", "@lib/a.js", "pkg/src/a.ts", "pkg/src/a.js")).toBe("pkg/src/a.js");
    expect(resolveWith(options, "pkg/i.ts", "@lib/dir", "pkg/src/dir/index.d.ts")).toBe("pkg/src/dir/index.d.ts");
  });

  test("a baseUrl alone resolves non-relative imports against it", () => {
    expect(resolveWith({ baseUrl: "src" }, "src/app/main.ts", "utils/format", "src/utils/format.ts")).toBe("src/utils/format.ts");
    expect(resolveWith({ baseUrl: "src" }, "src/app/main.ts", "utils", "src/utils/index.ts")).toBe("src/utils/index.ts");
    expect(resolveWith({ baseUrl: "." }, "src/main.ts", "src/helper.js", "src/helper.ts")).toBe("src/helper.ts");
    expect(resolveWith({ baseUrl: "." }, "main.ts", "lib/x", "lib/x.mts")).toBe("lib/x.mts");
  });

  test("a failed paths lookup falls through to the baseUrl", () => {
    const options = { baseUrl: "src", paths: { "@/*": ["nowhere/*"] } };
    expect(resolveWith(options, "src/i.ts", "@/x", "src/@/x.ts")).toBe("src/@/x.ts");
    expect(resolveWith({ baseUrl: "src", paths: { "other/*": ["nowhere/*"] } }, "src/i.ts", "shared/x", "src/shared/x.ts")).toBe("src/shared/x.ts");
  });

  test("without a baseUrl a non-relative specifier is never resolved against the importer or the root", () => {
    expect(resolveWith({}, "src/i.ts", "utils/format", "src/utils/format.ts", "utils/format.ts")).toBeNull();
    expect(resolveWith({ paths: { "@/*": ["src/*"] } }, "src/i.ts", "utils/format", "src/utils/format.ts", "utils/format.ts")).toBeNull();
  });

  test("bare packages that resolve to nothing stay unresolved", () => {
    const options = { baseUrl: ".", paths: { "@/*": ["src/*"], "external": ["missing"] } };
    const files = ["src/a.ts", "main.ts"] as const;
    for (const specifier of ["express", "@scope/pkg", "lodash/fp", "node:fs", "fs", "external", "@/nothing", "https://example.com/x.js", "react/jsx-runtime"]) {
      expect(resolveWith(options, "main.ts", specifier, ...files)).toBeNull();
      expect(resolveWith({}, "main.ts", specifier, ...files)).toBeNull();
    }
  });

  test("an absolute specifier is not combined with the baseUrl", () => {
    expect(resolveWith({ baseUrl: "src" }, "src/i.ts", "/etc/x", "src/etc/x.ts")).toBeNull();
    expect(resolveWith({ baseUrl: "src" }, "src/i.ts", "C:/etc/x", "src/C:/etc/x.ts")).toBeNull();
  });

  test("a pattern or target with more than one * is not interpreted", () => {
    expect(resolveWith({ paths: { "a/*/*": ["m/*"] } }, "i.ts", "a/b/c", "m/b.ts")).toBeNull();
    expect(resolveWith({ paths: { "a/*": ["m/*/*"] } }, "i.ts", "a/b", "m/b/b.ts")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// End to end through the engine
// ---------------------------------------------------------------------------------------------

describe("TypeScript resolution through the analysis pipeline", () => {
  let engine: LegacyExodusEngine;
  const workspaces: string[] = [];

  beforeAll(async () => {
    engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();
  });
  afterAll(async () => {
    await engine.shutdown();
    for (const workspace of workspaces) await rm(workspace, { recursive: true, force: true });
  });

  async function moduleEdges(files: Readonly<Record<string, string>>): Promise<readonly string[]> {
    const projectPath = await mkdtemp(join(tmpdir(), "lx-ts-resolution-"));
    workspaces.push(projectPath);
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(projectPath, path)), { recursive: true });
      await writeFile(join(projectPath, path), content);
    }
    const result = await engine.execute({ id: randomUUID(), type: "AnalyzeProject", createdAt: new Date(), payload: { projectId: randomUUID(), path: projectPath, refresh: true } });
    if (result.type !== "AnalyzeProject") throw new Error(`Expected AnalyzeProject, got ${result.type}`);
    const graph = JSON.parse(await readFile(join(projectPath, ".discovery", "dependency-graph.json"), "utf8")) as {
      readonly moduleGraph: { readonly edges: readonly { readonly sourceFilePath: string; readonly targetFilePath: string; readonly moduleSpecifier: string }[] };
    };
    return graph.moduleGraph.edges
      .map((edge) => `${edge.sourceFilePath} -> ${edge.targetFilePath} (${edge.moduleSpecifier})`)
      .sort();
  }

  const source = (name: string): string => `export function ${name}(): number { return 1; }\n`;

  test("resolves .js specifiers, a JSONC tsconfig with extends, and paths precedence in one project", async () => {
    const edges = await moduleEdges({
      "tsconfig.json": "{\n  // generated by tsc --init\n  \"extends\": \"./tsconfig.base\",\n  \"compilerOptions\": { \"baseUrl\": \"src\", },\n}\n",
      "tsconfig.base.json": "{ \"compilerOptions\": { \"paths\": { \"@/*\": [\"*\"], \"@/_internal/*\": [\"internal-v2/*\"] } } }",
      "src/a.ts": source("a"),
      "src/_internal/x.ts": source("generic"),
      "src/internal-v2/x.ts": source("specific"),
      "src/shared/util.ts": source("util"),
      "src/main.ts": [
        "import { a } from './a.js';",
        "import { generic } from '@/_internal/x';",
        "import { util } from 'shared/util';",
        "import express from 'express';",
        "export const total = a() + generic() + util();",
        "",
      ].join("\n"),
    });
    expect(edges).toEqual([
      "src/main.ts -> src/a.ts (./a.js)",
      "src/main.ts -> src/internal-v2/x.ts (@/_internal/x)",
      "src/main.ts -> src/shared/util.ts (shared/util)",
    ]);
  }, 30_000);

  test("analysis still completes, without aliases, when tsconfig.json is invalid", async () => {
    const edges = await moduleEdges({
      "tsconfig.json": "{ \"compilerOptions\": { \"paths\": { \"@/*\": [\"src/*\"] ",
      "src/a.ts": source("a"),
      "src/main.ts": "import { a } from '@/a';\nimport { a as again } from './a.js';\nexport const t = a() + again();\n",
    });
    expect(edges).toEqual(["src/main.ts -> src/a.ts (./a.js)"]);
  }, 30_000);
});

describe("AnalyzeProjectHandler tsconfig diagnostics", () => {
  const workspaces: string[] = [];
  afterAll(async () => {
    for (const workspace of workspaces) await rm(workspace, { recursive: true, force: true });
  });

  test("keeps what the run could not use of the tsconfig, and forgets it on the next run", async () => {
    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());
    const handler = new AnalyzeProjectHandler(new DiscoveryEngine(), new ParserManager(registry), new JavaScriptSymbolExtractor());
    const projectPath = await mkdtemp(join(tmpdir(), "lx-ts-diagnostics-"));
    workspaces.push(projectPath);
    await mkdir(join(projectPath, "src"), { recursive: true });
    await writeFile(join(projectPath, "src", "a.ts"), "export const a = 1;\n");
    const run = () => handler.handle({ id: randomUUID(), type: "AnalyzeProject", createdAt: new Date(), payload: { projectId: randomUUID(), path: projectPath, refresh: true } });

    expect(handler.getTsConfigDiagnostics()).toEqual([]);
    await writeFile(join(projectPath, "tsconfig.json"), "{ \"compilerOptions\": ");
    const broken = await run();
    expect(broken.analysis).toBeDefined();
    expect(handler.getTsConfigDiagnostics().map((diagnostic) => [diagnostic.code, diagnostic.file])).toEqual([["TSCONFIG_PARSE_ERROR", "tsconfig.json"]]);

    await writeFile(join(projectPath, "tsconfig.json"), "{ // fixed\n \"compilerOptions\": { \"baseUrl\": \".\", }, }");
    await run();
    expect(handler.getTsConfigDiagnostics()).toEqual([]);
  }, 30_000);
});
