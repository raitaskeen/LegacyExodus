import type { ParserOptions } from "@babel/parser";
import { immutable } from "@shared/immutability";

type ParserPlugins = NonNullable<ParserOptions["plugins"]>;
type SourceType = NonNullable<ParserOptions["sourceType"]>;

const DECLARATION_FILE = /\.d\.[mc]?ts$/;

function dialect(
  plugins: ParserPlugins,
  sourceType: SourceType,
  allowReturnOutsideFunction = false,
): Readonly<ParserOptions> {
  return immutable({
    allowReturnOutsideFunction,
    errorRecovery: true,
    plugins,
    sourceType,
  });
}

/**
 * Babel options for one file, chosen from the file path's extension (case-insensitive) alone.
 * The TypeScript, TSX, declaration and JavaScript grammars disagree on the same text
 * (`<T>(x) => x`, `<number>v`, `a < b > (c)`, ambient declarations), so no single plugin set parses
 * every dialect correctly. JavaScript uses Flow with `all: false`: annotations still parse, but an
 * ambiguous `<` stays relational unless an `@flow` pragma is present. ES module and CommonJS syntax
 * follow the extension where it fixes the source type; `.cts` is TypeScript that is written as ESM.
 */
export function javascriptParserOptionsFor(path: string): Readonly<ParserOptions> {
  const file = path.toLowerCase();

  if (DECLARATION_FILE.test(file)) {
    return dialect(
      [["typescript", { dts: true }], "decorators"],
      file.endsWith(".d.ts") ? "unambiguous" : "module",
    );
  }
  if (file.endsWith(".tsx")) {
    return dialect(["jsx", "typescript", "decorators"], "unambiguous");
  }
  if (file.endsWith(".mts") || file.endsWith(".cts")) {
    return dialect(["typescript", "decorators"], "module");
  }
  if (file.endsWith(".ts")) {
    return dialect(["typescript", "decorators"], "unambiguous");
  }
  if (file.endsWith(".cjs")) {
    return dialect(["jsx", ["flow", { all: false }], "decorators"], "script", true);
  }
  if (file.endsWith(".mjs")) {
    return dialect(["jsx", ["flow", { all: false }], "decorators"], "module");
  }
  return dialect(["jsx", ["flow", { all: false }], "decorators"], "unambiguous");
}
