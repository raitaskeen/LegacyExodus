import { describe, expect, it } from "bun:test";
import { JavaScriptParser, type ParseRequest } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";
import { DeterministicCallGraphBuilder } from "@semantic/call-graph-builder";

describe("Milestone P1 — Class Field Extraction & Private Member Identifier Resolution (F-03)", () => {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const callGraphBuilder = new DeterministicCallGraphBuilder();

  function createRequest(source: string, path = "src/models/user.js"): ParseRequest {
    return {
      file: {
        id: path,
        path,
        language: "javascript",
        size: source.length,
      },
      source,
    };
  }

  async function extract(code: string, sourcePath = "src/models/user.js") {
    const parseResponse = await parser.parse(createRequest(code, sourcePath));
    return {
      ast: parseResponse.result!,
      table: extractor.extract(parseResponse.result!),
    };
  }

  // ─── 1. Public Instance Field Extraction ────────────────────────────────────
  it("Scenario 1: extracts public instance field as a variable symbol with container and value", async () => {
    const code = `
      class User {
        field = "val";
      }
    `;
    const { table } = await extract(code);
    const fieldSym = table.symbols.find((s) => s.name === "field");

    expect(fieldSym).toBeDefined();
    expect(fieldSym?.kind).toBe("variable");
    expect(fieldSym?.containerName).toBe("User");
    expect(fieldSym?.containerId).toBeDefined();
    expect(fieldSym?.value).toBe("val");
    expect(fieldSym?.anonymous).toBe(false);
  });

  // ─── 2. Static Class Field Extraction ───────────────────────────────────────
  it("Scenario 2: extracts static class field with literal value and container linkage", async () => {
    const code = `
      class Config {
        static maxConnections = 100;
        static enabled = true;
      }
    `;
    const { table } = await extract(code);
    const maxSym = table.symbols.find((s) => s.name === "maxConnections");
    const enabledSym = table.symbols.find((s) => s.name === "enabled");

    expect(maxSym).toBeDefined();
    expect(maxSym?.kind).toBe("variable");
    expect(maxSym?.value).toBe(100);
    expect(maxSym?.containerName).toBe("Config");

    expect(enabledSym).toBeDefined();
    expect(enabledSym?.kind).toBe("variable");
    expect(enabledSym?.value).toBe(true);
    expect(enabledSym?.containerName).toBe("Config");
  });

  // ─── 3. Private Class Field Extraction ──────────────────────────────────────
  it("Scenario 3: extracts private class field preserving # prefix identifier and container", async () => {
    const code = `
      class Vault {
        #secretKey = 42;
      }
    `;
    const { table } = await extract(code);
    const secretSym = table.symbols.find((s) => s.name === "#secretKey");

    expect(secretSym).toBeDefined();
    expect(secretSym?.kind).toBe("variable");
    expect(secretSym?.containerName).toBe("Vault");
    expect(secretSym?.containerId).toBeDefined();
    expect(secretSym?.value).toBe(42);
    expect(secretSym?.anonymous).toBe(false);
  });

  // ─── 4. Private Class Method Naming ─────────────────────────────────────────
  it("Scenario 4: resolves private method name as #name instead of anonymous-method", async () => {
    const code = `
      class Authenticator {
        #validate(token) {
          return Boolean(token);
        }
      }
    `;
    const { table } = await extract(code);
    const anonMethod = table.symbols.find((s) => s.name === "anonymous-method");
    const validateMethod = table.symbols.find((s) => s.name === "#validate");

    expect(anonMethod).toBeUndefined();
    expect(validateMethod).toBeDefined();
    expect(validateMethod?.kind).toBe("method");
    expect(validateMethod?.containerName).toBe("Authenticator");
    expect(validateMethod?.parameters).toEqual(["token"]);
    expect(validateMethod?.anonymous).toBe(false);
  });

  // ─── 5. Arrow Function Class Field as Method ───────────────────────────────
  it("Scenario 5: treats arrow function and function expression field initializers as methods", async () => {
    const code = `
      class Component {
        onClick = (event) => { return event; };
        onSubmit = function(data, isValid) { return isValid; };
      }
    `;
    const { table } = await extract(code);
    const clickSym = table.symbols.find((s) => s.name === "onClick");
    const submitSym = table.symbols.find((s) => s.name === "onSubmit");

    expect(clickSym).toBeDefined();
    expect(clickSym?.kind).toBe("method");
    expect(clickSym?.containerName).toBe("Component");
    expect(clickSym?.parameters).toEqual(["event"]);
    expect(clickSym?.anonymous).toBe(false);

    expect(submitSym).toBeDefined();
    expect(submitSym?.kind).toBe("method");
    expect(submitSym?.containerName).toBe("Component");
    expect(submitSym?.parameters).toEqual(["data", "isValid"]);
    expect(submitSym?.anonymous).toBe(false);
  });

  // ─── 6. Uninitialized Class Fields ──────────────────────────────────────────
  it("Scenario 6: extracts uninitialized class fields as variables without value", async () => {
    const code = `
      class Account {
        balance;
        #internalState;
      }
    `;
    const { table } = await extract(code);
    const balanceSym = table.symbols.find((s) => s.name === "balance");
    const stateSym = table.symbols.find((s) => s.name === "#internalState");

    expect(balanceSym).toBeDefined();
    expect(balanceSym?.kind).toBe("variable");
    expect(balanceSym?.value).toBeUndefined();
    expect(balanceSym?.containerName).toBe("Account");

    expect(stateSym).toBeDefined();
    expect(stateSym?.kind).toBe("variable");
    expect(stateSym?.value).toBeUndefined();
    expect(stateSym?.containerName).toBe("Account");
  });

  // ─── 7. Dynamic Computed Property Negative Case ────────────────────────────
  it("Scenario 7: does NOT invent symbols for dynamic computed class fields", async () => {
    const code = `
      class DynamicHost {
        [Math.random() > 0.5 ? "a" : "b"] = 123;
        [getFieldName()] = "dynamic";
      }
    `;
    const { table } = await extract(code);
    const phantomSymbols = table.symbols.filter(
      (s) => s.name === "a" || s.name === "b" || s.name === "getFieldName",
    );
    expect(phantomSymbols.length).toBe(0);
  });

  // ─── 8. Summary Counts Across Multi-Member Classes ──────────────────────────
  it("Scenario 8: correctly tallies class, method, and variable summaries", async () => {
    const code = `
      class Service {
        field = "hello";
        static count = 1;
        #key = "secret";
        uninit;
        #calc() { return 42; }
        action = (x) => x;
        regularMethod() { return true; }
      }
    `;
    const { table } = await extract(code);

    expect(table.summary.classes).toBe(1);
    // Methods: #calc, action, regularMethod = 3
    expect(table.summary.methods).toBe(3);
    // Variables: field, count, #key, uninit = 4
    expect(table.summary.variables).toBe(4);
  });

  // ─── 9. Determinism Across Invocations ──────────────────────────────────────
  it("Scenario 9: produces identical symbol tables and hash IDs across repeated invocations", async () => {
    const code = `
      class PaymentGateway {
        #apiKey = "sk_live_123";
        timeoutMs = 5000;
        process = (tx) => { return this.#execute(tx); };
        #execute(tx) { return true; }
      }
    `;
    const first = await extract(code);
    const second = await extract(code);

    expect(first.table.summary).toEqual(second.table.summary);
    expect(first.table.symbols.length).toBe(second.table.symbols.length);
    for (let i = 0; i < first.table.symbols.length; i++) {
      expect(first.table.symbols[i]?.id).toBe(second.table.symbols[i]?.id);
      expect(first.table.symbols[i]?.name).toBe(second.table.symbols[i]?.name);
      expect(first.table.symbols[i]?.kind).toBe(second.table.symbols[i]?.kind);
    }
  });

  // ─── 10. Downstream Call Graph Integration ──────────────────────────────────
  it("Scenario 10: resolves calls to private methods and arrow field methods via this", async () => {
    const code = `
      class Pipeline {
        #transform = (x) => { return x + 1; };
        #validate(x) { return Boolean(x); }
        run(input) {
          this.#validate(input);
          return this.#transform(input);
        }
      }
    `;
    const { ast, table } = await extract(code);
    const callGraph = callGraphBuilder.build([ast], [table], { nodes: [], edges: [], cycles: [] });

    const validateCall = callGraph.calls.find((c) => c.calleeName === "this.#validate");
    const transformCall = callGraph.calls.find((c) => c.calleeName === "this.#transform");

    expect(validateCall).toBeDefined();
    expect(validateCall?.targetSymbolId).toBeDefined();

    const validateSym = table.symbols.find((s) => s.name === "#validate");
    expect(validateCall?.targetSymbolId).toBe(validateSym?.id);

    expect(transformCall).toBeDefined();
    expect(transformCall?.targetSymbolId).toBeDefined();

    const transformSym = table.symbols.find((s) => s.name === "#transform");
    expect(transformCall?.targetSymbolId).toBe(transformSym?.id);
  });
});
