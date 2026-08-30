# Unit Testing Guide

This document explains how to write and run unit tests for the **LegacyExodus** static analysis engine.

---

## 1. Unit Test Framework

LegacyExodus uses the built-in **Bun Test runner** (`bun:test`).

* Fast execution across 613 tests
* Built-in code coverage reporting (`bun test --coverage`)
* Standard Jest/Vitest-compatible assertion API (`describe`, `it`, `expect`, `beforeEach`)

---

## 2. Writing Subsystem Unit Tests

### Example: Testing Symbol & Scope Extraction
When testing symbol extraction, write isolated test cases verifying exact symbol names, kinds, scopes, and flags:

```typescript
import { describe, expect, it } from "bun:test";
import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

describe("JavaScriptSymbolExtractor - Var Scope", () => {
  it("hoists var declarations inside nested blocks to the function scope", async () => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();

    const code = `
      function outer() {
        if (true) {
          var hoistedVar = 42;
        }
      }
    `;

    const astResult = await parser.parse({
      content: code,
      fileId: "test-file-id",
      path: "test.js",
    });

    const result = await extractor.extract({
      ast: astResult.ast,
      fileId: "test-file-id",
      path: "test.js",
    });

    const symbol = result.symbols.find((s) => s.name === "hoistedVar");
    expect(symbol).toBeDefined();
    expect(symbol?.scopeId).toContain("scope:function");
  });
});
```

---

## 3. Running Focused Unit Tests

```bash
# Run all unit tests
bun test tests/unit/

# Run a specific unit test file
bun test tests/unit/symbols/destructuring-pattern-symbols.test.ts

# Filter tests by test name
bun test -t "hoists var declarations"
```

---

## Related Documentation

* **[Testing Strategy](../testing-strategy.md):** Overall testing architecture.
* **[Integration Testing](integration-testing.md):** Writing end-to-end multi-stage pipeline tests.
