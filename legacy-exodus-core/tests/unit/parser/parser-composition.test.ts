import { describe, expect, test } from "bun:test";

import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";
import { createEngineContext } from "@runtime/composition/services";

describe("parser runtime composition", () => {
  test("provides an isolated parser registry and manager through dependency composition", (): void => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });

    expect(context.parserRegistry).toBeInstanceOf(ParserRegistry);
    expect(context.parserManager).toBeInstanceOf(ParserManager);
    expect(context.parserRegistry.findByLanguage("javascript")).toBeInstanceOf(JavaScriptParser);
  });
});
