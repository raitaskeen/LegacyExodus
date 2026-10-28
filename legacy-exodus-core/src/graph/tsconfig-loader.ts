import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ModuleResolutionOptions } from "./module-resolver";

/* ------------------------------------------------------------------------------------------ *
 * JSONC
 * ------------------------------------------------------------------------------------------ */

export type JsoncResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string; readonly offset: number };

const MAX_JSONC_DEPTH = 128;

class JsoncSyntaxError extends Error {
  public constructor(message: string, public readonly offset: number) {
    super(message);
  }
}

/**
 * Parses JSON with comments (`//`, `/* *\/`), trailing commas before `}` and `]`, and an optional
 * byte order mark: the dialect `tsc --init` writes. Objects have a null prototype, so a
 * `__proto__` key is plain data. Failure messages describe the position, never the content.
 */
export function parseJsonc(text: string): JsoncResult {
  try {
    return { ok: true, value: parseJsoncDocument(text) };
  } catch (error: unknown) {
    if (error instanceof JsoncSyntaxError) return { ok: false, message: error.message, offset: error.offset };
    throw error;
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = { "\"": "\"", "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

function parseJsoncDocument(text: string): unknown {
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const fail = (message: string, at: number = pos): never => {
    throw new JsoncSyntaxError(message, at);
  };

  const skipTrivia = (): void => {
    for (;;) {
      const code = text.charCodeAt(pos);
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0b || code === 0x0c || code === 0xa0 || code === 0xfeff || code === 0x2028 || code === 0x2029) {
        pos += 1;
      } else if (code === 0x2f && text.charCodeAt(pos + 1) === 0x2f) {
        pos += 2;
        while (pos < text.length && text.charCodeAt(pos) !== 0x0a && text.charCodeAt(pos) !== 0x0d) pos += 1;
      } else if (code === 0x2f && text.charCodeAt(pos + 1) === 0x2a) {
        const end = text.indexOf("*/", pos + 2);
        if (end < 0) fail("Unterminated block comment", pos);
        pos = end + 2;
      } else {
        return;
      }
    }
  };

  const parseString = (): string => {
    const start = pos;
    pos += 1;
    let result = "";
    let chunk = pos;
    for (;;) {
      if (pos >= text.length) fail("Unterminated string", start);
      const code = text.charCodeAt(pos);
      if (code === 0x22) {
        result += text.slice(chunk, pos);
        pos += 1;
        return result;
      }
      if (code === 0x0a || code === 0x0d) fail("Unterminated string", start);
      if (code !== 0x5c) {
        pos += 1;
        continue;
      }
      result += text.slice(chunk, pos);
      const escape = text.charAt(pos + 1);
      const simple = SIMPLE_ESCAPES[escape];
      if (simple !== undefined) {
        result += simple;
        pos += 2;
      } else if (escape === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(pos + 2, pos + 6))) {
        result += String.fromCharCode(Number.parseInt(text.slice(pos + 2, pos + 6), 16));
        pos += 6;
      } else {
        fail("Invalid escape sequence", pos);
      }
      chunk = pos;
    }
  };

  const parseValue = (depth: number): unknown => {
    skipTrivia();
    const code = text.charCodeAt(pos);
    if (code === 0x7b) return parseObject(depth);
    if (code === 0x5b) return parseArray(depth);
    if (code === 0x22) return parseString();
    if (code === 0x2d || (code >= 0x30 && code <= 0x39)) {
      NUMBER.lastIndex = pos;
      const match = NUMBER.exec(text);
      if (match === null) return fail("Invalid number");
      pos += match[0].length;
      return Number(match[0]);
    }
    for (const [literal, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(literal, pos)) {
        pos += literal.length;
        return value;
      }
    }
    return fail(pos >= text.length ? "Unexpected end of input" : "Unexpected token");
  };

  const parseObject = (depth: number): unknown => {
    if (depth >= MAX_JSONC_DEPTH) fail("Nesting is too deep");
    pos += 1;
    const result = Object.create(null) as Record<string, unknown>;
    for (;;) {
      skipTrivia();
      if (text.charCodeAt(pos) === 0x7d) {
        pos += 1;
        return result;
      }
      if (text.charCodeAt(pos) !== 0x22) fail("Expected a property name in double quotes");
      const key = parseString();
      skipTrivia();
      if (text.charCodeAt(pos) !== 0x3a) fail("Expected ':' after the property name");
      pos += 1;
      result[key] = parseValue(depth + 1);
      skipTrivia();
      const next = text.charCodeAt(pos);
      if (next === 0x2c) pos += 1;
      else if (next !== 0x7d) fail("Expected ',' or '}'");
    }
  };

  const parseArray = (depth: number): unknown => {
    if (depth >= MAX_JSONC_DEPTH) fail("Nesting is too deep");
    pos += 1;
    const result: unknown[] = [];
    for (;;) {
      skipTrivia();
      if (text.charCodeAt(pos) === 0x5d) {
        pos += 1;
        return result;
      }
      result.push(parseValue(depth + 1));
      skipTrivia();
      const next = text.charCodeAt(pos);
      if (next === 0x2c) pos += 1;
      else if (next !== 0x5d) fail("Expected ',' or ']'");
    }
  };

  const value = parseValue(0);
  skipTrivia();
  if (pos < text.length) fail("Unexpected content after the root value");
  return value;
}

/* ------------------------------------------------------------------------------------------ *
 * tsconfig.json / jsconfig.json
 * ------------------------------------------------------------------------------------------ */

export type TsConfigDiagnosticCode =
  | "TSCONFIG_READ_ERROR"
  | "TSCONFIG_PARSE_ERROR"
  | "TSCONFIG_INVALID_SHAPE"
  | "TSCONFIG_EXTENDS_UNRESOLVED"
  | "TSCONFIG_EXTENDS_CYCLE"
  | "TSCONFIG_EXTENDS_TOO_DEEP"
  | "TSCONFIG_EXTENDS_OUTSIDE_PROJECT";

export interface TsConfigDiagnostic {
  readonly code: TsConfigDiagnosticCode;
  /** Project-root-relative POSIX path of the config the problem was found in. */
  readonly file: string;
  /** Names the problem and where it is. File content is quoted only as far as an offending `extends` entry or `paths` pattern. */
  readonly message: string;
}

export interface TsConfigResolution {
  readonly options: ModuleResolutionOptions;
  /** Everything that was skipped or ignored; an empty list means the configuration was read in full. */
  readonly diagnostics: readonly TsConfigDiagnostic[];
  /** The root config that was read, or null when the project has neither file. */
  readonly configFile: "tsconfig.json" | "jsconfig.json" | null;
}

const ROOT_CONFIG_FILES = ["tsconfig.json", "jsconfig.json"] as const;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_EXTENDS_DEPTH = 32;
const MAX_QUOTED_LENGTH = 200;

/** The options that matter for module resolution, with paths still anchored to where they were written. */
interface EffectiveOptions {
  /** Absolute directory. */
  readonly baseUrl: string | undefined;
  readonly paths: { readonly entries: readonly (readonly [string, readonly string[]])[]; readonly definedInFile: string } | undefined;
}

interface LoadContext {
  /** Absolute, as given by the caller. */
  readonly projectRoot: string;
  /** `projectRoot` with symbolic links resolved, for the containment check on extended configs. */
  readonly realProjectRoot: string;
  /** Directory of the outermost config; the value of `${configDir}` everywhere in the chain. */
  readonly rootConfigDirectory: string;
  readonly rootConfigName: string;
  readonly diagnostics: TsConfigDiagnostic[];
}

type ReadOutcome =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "absent" }
  | { readonly kind: "error"; readonly reason: string };

/**
 * Reads the module-resolution settings of the project's root `tsconfig.json` (or, when there is
 * none, `jsconfig.json`), following `extends`. Never throws: a config that cannot be used yields
 * no aliases and a diagnostic, an `extends` entry that cannot be used is skipped with one.
 */
export async function loadTsConfigResolution(projectPath: string): Promise<TsConfigResolution> {
  const projectRoot = resolve(projectPath);
  const diagnostics: TsConfigDiagnostic[] = [];
  const done = (options: ModuleResolutionOptions, configFile: TsConfigResolution["configFile"]): TsConfigResolution =>
    Object.freeze({ options: Object.freeze(options), diagnostics: Object.freeze(diagnostics), configFile });

  try {
    for (const name of ROOT_CONFIG_FILES) {
      const file = join(projectRoot, name);
      const outcome = await readConfigText(file);
      if (outcome.kind === "absent") continue;
      const context: LoadContext = { projectRoot, realProjectRoot: await realpath(projectRoot).catch(() => projectRoot), rootConfigDirectory: projectRoot, rootConfigName: name, diagnostics };
      if (outcome.kind === "error") {
        diagnostics.push({ code: "TSCONFIG_READ_ERROR", file: name, message: `Cannot read the file: ${outcome.reason}.` });
        return done({}, name);
      }
      const effective = await loadConfig(file, outcome.text, [await canonicalKey(file)], context);
      return done(effective === undefined ? {} : toResolutionOptions(effective, context), name);
    }
    return done({}, null);
  } catch (error: unknown) {
    // Defensive: the steps above handle their own failures; anything else must still not stop analysis.
    diagnostics.push({ code: "TSCONFIG_READ_ERROR", file: "tsconfig.json", message: `Unexpected failure while reading the configuration: ${error instanceof Error ? error.name : "unknown error"}.` });
    return done({}, null);
  }
}

async function loadConfig(
  file: string,
  text: string,
  chain: readonly string[],
  context: LoadContext,
): Promise<EffectiveOptions | undefined> {
  const display = displayPath(context, file);
  const parsed = parseJsonc(text);
  if (!parsed.ok) {
    const { line, column } = lineAndColumn(text, parsed.offset);
    context.diagnostics.push({ code: "TSCONFIG_PARSE_ERROR", file: display, message: `${parsed.message} at line ${line}, column ${column}.` });
    return undefined;
  }
  const root = parsed.value;
  if (!isRecord(root)) {
    context.diagnostics.push({ code: "TSCONFIG_INVALID_SHAPE", file: display, message: "The root value must be an object." });
    return undefined;
  }

  let inherited: EffectiveOptions = { baseUrl: undefined, paths: undefined };
  const extendsValue = root["extends"];
  if (extendsValue !== undefined) {
    const entries: readonly unknown[] = typeof extendsValue === "string" ? [extendsValue] : Array.isArray(extendsValue) ? extendsValue : [];
    if (typeof extendsValue !== "string" && !Array.isArray(extendsValue)) {
      context.diagnostics.push({ code: "TSCONFIG_INVALID_SHAPE", file: display, message: "\"extends\" must be a string or an array of strings." });
    }
    for (const entry of entries) {
      if (typeof entry !== "string") {
        context.diagnostics.push({ code: "TSCONFIG_INVALID_SHAPE", file: display, message: "Every \"extends\" entry must be a string." });
        continue;
      }
      const base = await loadExtended(entry, file, chain, context);
      if (base !== undefined) inherited = overlay(inherited, base);
    }
  }
  return overlay(inherited, readCompilerOptions(root["compilerOptions"], file, context));
}

/** TypeScript's `extends` semantics: a later source overrides an earlier one, option by option. */
function overlay(base: EffectiveOptions, top: EffectiveOptions): EffectiveOptions {
  return { baseUrl: top.baseUrl ?? base.baseUrl, paths: top.paths ?? base.paths };
}

function readCompilerOptions(value: unknown, file: string, context: LoadContext): EffectiveOptions {
  const none: EffectiveOptions = { baseUrl: undefined, paths: undefined };
  const display = displayPath(context, file);
  if (value === undefined) return none;
  if (!isRecord(value)) {
    context.diagnostics.push({ code: "TSCONFIG_INVALID_SHAPE", file: display, message: "\"compilerOptions\" must be an object." });
    return none;
  }
  const directory = dirname(file);

  let baseUrl: string | undefined;
  const rawBaseUrl = value["baseUrl"];
  if (typeof rawBaseUrl === "string") {
    baseUrl = resolve(directory, substituteConfigDirectory(rawBaseUrl, context));
  } else if (rawBaseUrl !== undefined) {
    context.diagnostics.push({ code: "TSCONFIG_INVALID_SHAPE", file: display, message: "\"compilerOptions.baseUrl\" must be a string and was ignored." });
  }

  let paths: EffectiveOptions["paths"];
  const rawPaths = value["paths"];
  if (isRecord(rawPaths)) {
    const entries: (readonly [string, readonly string[]])[] = [];
    for (const [pattern, targets] of Object.entries(rawPaths)) {
      if (!Array.isArray(targets) || targets.length === 0 || !targets.every((target): target is string => typeof target === "string")) {
        context.diagnostics.push({ code: "TSCONFIG_INVALID_SHAPE", file: display, message: `The "compilerOptions.paths" entry for ${quoted(pattern)} must be a non-empty array of strings and was ignored.` });
        continue;
      }
      entries.push([pattern, targets.map((target) => substituteConfigDirectory(target, context))]);
    }
    paths = { entries, definedInFile: file };
  } else if (rawPaths !== undefined) {
    context.diagnostics.push({ code: "TSCONFIG_INVALID_SHAPE", file: display, message: "\"compilerOptions.paths\" must be an object and was ignored." });
  }
  return { baseUrl, paths };
}

/** Windows authors write backslashes; `${configDir}` (TypeScript 5.5) names the outermost config's directory. */
function substituteConfigDirectory(value: string, context: LoadContext): string {
  const normalized = value.replaceAll("\\", "/");
  return normalized.startsWith("${configDir}")
    ? `${context.rootConfigDirectory.replaceAll("\\", "/")}${normalized.slice("${configDir}".length)}`
    : normalized;
}

function toResolutionOptions(effective: EffectiveOptions, context: LoadContext): ModuleResolutionOptions {
  const baseUrl = effective.baseUrl === undefined ? undefined : toProjectRelative(context.projectRoot, effective.baseUrl);
  if (effective.baseUrl !== undefined && baseUrl === undefined) {
    // On another drive nothing it names can be a discovered file, and no relative path expresses it.
    context.diagnostics.push({ code: "TSCONFIG_INVALID_SHAPE", file: context.rootConfigName, message: "\"compilerOptions.baseUrl\" is on another drive than the project; no alias was applied." });
    return {};
  }
  const paths: Record<string, readonly string[]> = {};
  if (effective.paths !== undefined) {
    // With a baseUrl in effect, targets are relative to it wherever `paths` was written; without one
    // they are relative to the config that wrote `paths`, which is rebased onto the project root here.
    const anchor = effective.baseUrl ?? dirname(effective.paths.definedInFile);
    const output = effective.baseUrl ?? context.projectRoot;
    for (const [pattern, targets] of effective.paths.entries) {
      const converted: string[] = [];
      for (const target of targets) {
        const relativeTarget = toProjectRelative(output, resolve(anchor, target));
        if (relativeTarget === undefined) {
          context.diagnostics.push({ code: "TSCONFIG_INVALID_SHAPE", file: displayPath(context, effective.paths.definedInFile), message: `A target of ${quoted(pattern)} is on another drive and was ignored.` });
          continue;
        }
        converted.push(relativeTarget);
      }
      if (converted.length > 0) paths[pattern] = Object.freeze(converted);
    }
  }
  return {
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(Object.keys(paths).length === 0 ? {} : { paths }),
  };
}

/** POSIX path of `target` relative to `from`; undefined when no relative path exists (another drive). */
function toProjectRelative(from: string, target: string): string | undefined {
  const path = relative(from, target);
  if (isAbsolute(path)) return undefined;
  const posixPath = path.split(sep).join("/");
  return posixPath === "" ? "." : posixPath;
}

/* ---- extends resolution ---- */

async function loadExtended(
  entry: string,
  fromFile: string,
  chain: readonly string[],
  context: LoadContext,
): Promise<EffectiveOptions | undefined> {
  const display = displayPath(context, fromFile);
  if (chain.length >= MAX_EXTENDS_DEPTH) {
    context.diagnostics.push({ code: "TSCONFIG_EXTENDS_TOO_DEEP", file: display, message: `"extends" chains deeper than ${MAX_EXTENDS_DEPTH} configs are not followed; skipped ${quoted(entry)}.` });
    return undefined;
  }

  const resolved = await resolveExtends(entry.replaceAll("\\", "/"), fromFile, context);
  if (resolved.kind === "outside") {
    context.diagnostics.push({ code: "TSCONFIG_EXTENDS_OUTSIDE_PROJECT", file: display, message: `"extends" ${quoted(entry)} leads outside the project and was not followed.` });
    return undefined;
  }
  if (resolved.kind === "unresolved") {
    context.diagnostics.push({ code: "TSCONFIG_EXTENDS_UNRESOLVED", file: display, message: `"extends" ${quoted(entry)} could not be resolved and was skipped.` });
    return undefined;
  }
  if (chain.includes(resolved.key)) {
    context.diagnostics.push({ code: "TSCONFIG_EXTENDS_CYCLE", file: display, message: `"extends" ${quoted(entry)} leads back to a config that is already being read and was skipped.` });
    return undefined;
  }
  const outcome = await readConfigText(resolved.file);
  if (outcome.kind !== "ok") {
    const reason = outcome.kind === "absent" ? "the file does not exist" : outcome.reason;
    context.diagnostics.push({ code: "TSCONFIG_READ_ERROR", file: displayPath(context, resolved.file), message: `Cannot read the extended config: ${reason}.` });
    return undefined;
  }
  return loadConfig(resolved.file, outcome.text, [...chain, resolved.key], context);
}

type ExtendsTarget =
  | { readonly kind: "found"; readonly file: string; readonly key: string }
  | { readonly kind: "unresolved" }
  | { readonly kind: "outside" };

async function resolveExtends(specifier: string, fromFile: string, context: LoadContext): Promise<ExtendsTarget> {
  const directory = dirname(fromFile);
  if (specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../") || isAbsolute(specifier)) {
    const path = resolve(directory, specifier);
    return firstContainedFile(path.toLowerCase().endsWith(".json") ? [path] : [path, `${path}.json`], context);
  }

  // A package: node_modules directories from the extending file's directory up to the project root.
  for (let current = directory; isInside(context.projectRoot, current); current = dirname(current)) {
    const modules = join(current, "node_modules");
    const found = await firstContainedFile(
      [join(modules, specifier), `${join(modules, specifier)}.json`, join(modules, specifier, "tsconfig.json")],
      context,
    );
    if (found.kind !== "unresolved") return found;
    if (current === context.projectRoot || dirname(current) === current) break;
  }
  return { kind: "unresolved" };
}

/** The first candidate that is a regular file inside the project, checked lexically and through symlinks. */
async function firstContainedFile(candidates: readonly string[], context: LoadContext): Promise<ExtendsTarget> {
  for (const candidate of candidates) {
    if (!isInside(context.projectRoot, candidate)) return { kind: "outside" };
    const info = await stat(candidate).catch(() => undefined);
    if (info === undefined || !info.isFile()) continue;
    const real = await realpath(candidate).catch(() => undefined);
    if (real === undefined || !isInside(context.realProjectRoot, real)) return { kind: "outside" };
    return { kind: "found", file: candidate, key: pathKey(real) };
  }
  return { kind: "unresolved" };
}

/* ---- file access and small helpers ---- */

async function readConfigText(file: string): Promise<ReadOutcome> {
  try {
    const info = await stat(file);
    if (!info.isFile()) return { kind: "error", reason: "not a regular file" };
    if (info.size > MAX_CONFIG_BYTES) return { kind: "error", reason: `larger than ${MAX_CONFIG_BYTES} bytes` };
    return { kind: "ok", text: await readFile(file, "utf8") };
  } catch (error: unknown) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent" };
    return { kind: "error", reason: code ?? "unreadable" };
  }
}

async function canonicalKey(file: string): Promise<string> {
  return pathKey(await realpath(file).catch(() => file));
}

function pathKey(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isInside(root: string, path: string): boolean {
  const difference = relative(root, path);
  return difference === "" || (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`));
}

function displayPath(context: LoadContext, file: string): string {
  return toProjectRelative(context.projectRoot, file) ?? file.split(sep).join("/");
}

function lineAndColumn(text: string, offset: number): { readonly line: number; readonly column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function quoted(value: string): string {
  return JSON.stringify(value.length > MAX_QUOTED_LENGTH ? `${value.slice(0, MAX_QUOTED_LENGTH)}...` : value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof (error as { readonly code: unknown }).code === "string"
    ? (error as { readonly code: string }).code
    : undefined;
}
