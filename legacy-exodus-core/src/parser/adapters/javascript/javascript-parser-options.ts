import type { ParserOptions } from "@babel/parser";

export const javascriptParserOptions: Readonly<ParserOptions> = Object.freeze({
  allowReturnOutsideFunction: false,
  errorRecovery: true,
  plugins: ["jsx", "typescript", "decorators"] as NonNullable<ParserOptions["plugins"]>,
  sourceType: "unambiguous",
});
