import { describe, expect, it } from "bun:test";

import { JavaScriptParser, type ParseRequest } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";
import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";

function createRequest(source: string, language: "javascript" | "typescript" = "javascript"): ParseRequest {
  return {
    file: {
      id: "param-test",
      path: language === "typescript" ? "src/test.ts" : "src/test.js",
      language,
      size: source.length,
    },
    source,
  };
}

async function extract(source: string, language: "javascript" | "typescript" = "javascript") {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const parseResult = await parser.parse(createRequest(source, language));
  const ast = parseResult.result;
  const table = extractor.extract(ast);
  return { ast, table };
}

describe("F-04 — Complete Parameter Symbol Modeling", () => {
  it("1. models formal parameters of function declarations as variable symbols with declarationKind 'param'", async () => {
    const source = `
      function login(email, password) {
        return Boolean(email && password);
      }
    `;
    const { table } = await extract(source);

    const fn = table.symbols.find((s) => s.kind === "function" && s.name === "login");
    expect(fn).toBeDefined();
    expect(fn?.parameters).toEqual(["email", "password"]);

    const params = table.symbols.filter((s) => s.kind === "variable" && s.declarationKind === "param");
    expect(params.length).toBe(2);

    const emailParam = params.find((s) => s.name === "email");
    const passParam = params.find((s) => s.name === "password");

    expect(emailParam).toBeDefined();
    expect(emailParam?.containerName).toBe("login");
    expect(emailParam?.containerId).toBe(fn?.id);
    expect(emailParam?.scopeId).toBeDefined();
    expect(emailParam?.parameters).toEqual([]);
    expect(emailParam?.exported).toBe(false);
    expect(emailParam?.location?.start.line).toBe(2);

    expect(passParam).toBeDefined();
    expect(passParam?.containerName).toBe("login");
    expect(passParam?.containerId).toBe(fn?.id);
    expect(passParam?.scopeId).toBe(emailParam?.scopeId);
    expect(passParam?.parameters).toEqual([]);
  });

  it("2. models parameters of arrow functions and assigned function expressions", async () => {
    const source = `
      const calculate = (a, b) => a + b;
      const greet = function(greeting, target) { return greeting + " " + target; };
    `;
    const { table } = await extract(source);

    const calcFn = table.symbols.find((s) => s.kind === "function" && s.name === "calculate");
    expect(calcFn).toBeDefined();

    const paramA = table.symbols.find((s) => s.declarationKind === "param" && s.name === "a");
    const paramB = table.symbols.find((s) => s.declarationKind === "param" && s.name === "b");
    expect(paramA).toBeDefined();
    expect(paramB).toBeDefined();
    expect(paramA?.containerName).toBe("calculate");
    expect(paramA?.containerId).toBe(calcFn?.id);

    const greetFn = table.symbols.find((s) => s.kind === "function" && s.name === "greet");
    expect(greetFn).toBeDefined();

    const paramGreeting = table.symbols.find((s) => s.declarationKind === "param" && s.name === "greeting");
    const paramTarget = table.symbols.find((s) => s.declarationKind === "param" && s.name === "target");
    expect(paramGreeting).toBeDefined();
    expect(paramTarget).toBeDefined();
    expect(paramGreeting?.containerName).toBe("greet");
    expect(paramGreeting?.containerId).toBe(greetFn?.id);
  });

  it("3. models parameters of class methods and constructors", async () => {
    const source = `
      class UserService {
        constructor(config) {
          this.config = config;
        }
        updateUser(userId, data) {
          return true;
        }
        #privateHelper(token) {
          return token;
        }
      }
    `;
    const { table } = await extract(source);

    const ctorMethod = table.symbols.find((s) => s.kind === "method" && s.name === "constructor");
    expect(ctorMethod).toBeDefined();
    const configParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "config");
    expect(configParam).toBeDefined();
    expect(configParam?.containerName).toBe("constructor");
    expect(configParam?.containerId).toBe(ctorMethod?.id);

    const updateMethod = table.symbols.find((s) => s.kind === "method" && s.name === "updateUser");
    expect(updateMethod).toBeDefined();
    const userIdParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "userId");
    const dataParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "data");
    expect(userIdParam).toBeDefined();
    expect(dataParam).toBeDefined();
    expect(userIdParam?.containerName).toBe("updateUser");
    expect(userIdParam?.containerId).toBe(updateMethod?.id);

    const privMethod = table.symbols.find((s) => s.kind === "method" && s.name === "#privateHelper");
    expect(privMethod).toBeDefined();
    const tokenParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "token");
    expect(tokenParam).toBeDefined();
    expect(tokenParam?.containerName).toBe("#privateHelper");
    expect(tokenParam?.containerId).toBe(privMethod?.id);
  });

  it("4. models parameters of object methods", async () => {
    const source = `
      const handler = {
        handle(req, res) {
          return res.send(req.body);
        }
      };
    `;
    const { table } = await extract(source);

    const handleMethod = table.symbols.find((s) => s.kind === "method" && s.name === "handle");
    expect(handleMethod).toBeDefined();

    const reqParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "req");
    const resParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "res");
    expect(reqParam).toBeDefined();
    expect(resParam).toBeDefined();
    expect(reqParam?.containerName).toBe("handle");
    expect(reqParam?.containerId).toBe(handleMethod?.id);
  });

  it("5. models default parameters without treating default initializers as parameters", async () => {
    const source = `
      function fetchWithDefaults(url, timeout = 5000, retry = fallbackRetry()) {
        return url;
      }
    `;
    const { table } = await extract(source);

    const params = table.symbols.filter((s) => s.declarationKind === "param");
    expect(params.map((p) => p.name)).toEqual(["url", "timeout", "retry"]);
    expect(params.some((p) => p.name === "fallbackRetry")).toBe(false);
  });

  it("6. models rest parameters", async () => {
    const source = `
      function sum(base, ...numbers) {
        return numbers.reduce((acc, val) => acc + val, base);
      }
    `;
    const { table } = await extract(source);

    const sumParams = table.symbols.filter((s) => s.declarationKind === "param" && s.containerName === "sum");
    expect(sumParams.map((p) => p.name)).toEqual(["base", "numbers"]);
  });

  it("7. models object destructuring parameters with property aliasing", async () => {
    const source = `
      function processUser({ id, name: fullName, age = 30 }) {
        return fullName;
      }
    `;
    const { table } = await extract(source);

    const params = table.symbols.filter((s) => s.declarationKind === "param");
    expect(params.map((p) => p.name).sort()).toEqual(["age", "fullName", "id"]);
    // 'name' is the object key, not the bound variable symbol
    expect(params.some((p) => p.name === "name")).toBe(false);
  });

  it("8. models array destructuring parameters and rest elements", async () => {
    const source = `
      function processItems([first, , third = 0, ...remaining]) {
        return first;
      }
    `;
    const { table } = await extract(source);

    const params = table.symbols.filter((s) => s.declarationKind === "param");
    expect(params.map((p) => p.name).sort()).toEqual(["first", "remaining", "third"]);
  });

  it("9. models nested destructuring patterns", async () => {
    const source = `
      function locate({ user: { address: { coordinates: [lat, lng] } } }) {
        return lat + lng;
      }
    `;
    const { table } = await extract(source);

    const params = table.symbols.filter((s) => s.declarationKind === "param");
    expect(params.map((p) => p.name).sort()).toEqual(["lat", "lng"]);
  });

  it("10. models TypeScript type-annotated and optional parameters", async () => {
    const source = `
      function query(queryStr: string, limit?: number, ...tags: string[]): boolean {
        return true;
      }
    `;
    const { table } = await extract(source, "typescript");

    const params = table.symbols.filter((s) => s.declarationKind === "param");
    expect(params.map((p) => p.name)).toEqual(["queryStr", "limit", "tags"]);
  });

  it("11. excludes TypeScript 'this' pseudo-parameters from runtime parameter symbols", async () => {
    const source = `
      function handleEvent(this: void, eventName: string, payload: unknown): void {
        console.log(eventName);
      }
    `;
    const { table } = await extract(source, "typescript");

    const params = table.symbols.filter((s) => s.declarationKind === "param");
    expect(params.map((p) => p.name)).toEqual(["eventName", "payload"]);
    expect(params.some((p) => p.name === "this")).toBe(false);

    const fn = table.symbols.find((s) => s.kind === "function" && s.name === "handleEvent");
    expect(fn?.parameters).toEqual(["eventName", "payload"]);
  });

  it("12. models TypeScript constructor parameter properties", async () => {
    const source = `
      class DatabaseClient {
        constructor(public connectionString: string, private timeoutMs: number = 3000) {}
      }
    `;
    const { table } = await extract(source, "typescript");

    const params = table.symbols.filter((s) => s.declarationKind === "param");
    expect(params.map((p) => p.name)).toEqual(["connectionString", "timeoutMs"]);
    expect(params.every((p) => p.containerName === "constructor")).toBe(true);
  });

  it("13. enforces lexical scope and shadowing: inner declaration shadows parameter, which shadows outer", async () => {
    const source = `
      const x = "global";
      function demo(x) {
        const x_outer = x;
        {
          const x = "block";
          const x_inner = x;
        }
      }
    `;
    const { table } = await extract(source);

    const xSymbols = table.symbols.filter((s) => s.name === "x");
    expect(xSymbols.length).toBe(3);

    const globalX = xSymbols.find((s) => s.declarationKind === "const" && s.scopeId === "scope:module");
    const paramX = xSymbols.find((s) => s.declarationKind === "param");
    const blockX = xSymbols.find((s) => s.declarationKind === "const" && s.scopeId !== "scope:module");

    expect(globalX).toBeDefined();
    expect(paramX).toBeDefined();
    expect(blockX).toBeDefined();

    expect(paramX?.scopeId).not.toBe(globalX?.scopeId);
    expect(blockX?.scopeId).not.toBe(paramX?.scopeId);
  });

  it("14. prevents outer function hijacking in call graph when parameter shadows function name", async () => {
    const source = `
      function calculate(val) {
        return val * 2;
      }
      function runner(calculate) {
        return calculate(42);
      }
    `;
    const file = { id: "test-f04", path: "src/test.js", language: "javascript", size: source.length };
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const ast = (await parser.parse({ file, source })).result!;
    const table = extractor.extract(ast);
    const depGraph = new DeterministicDependencyGraphBuilder().build([table], [file]);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({
      astResults: [ast],
      dependencyGraph: depGraph,
      symbolTables: [table],
    });

    const calculateFn = table.symbols.find((s) => s.kind === "function" && s.name === "calculate");
    expect(calculateFn).toBeDefined();

    // runner's call to calculate should NOT resolve to the outer function calculate
    // because parameter 'calculate' shadows the outer function
    const runnerCallsToCalculate = analysis.calls.filter(
      (c) => c.callerName === "runner" && c.targetSymbolId === calculateFn?.id,
    );
    expect(runnerCallsToCalculate.length).toBe(0);
  });

  it("15. produces deterministic parameter symbol hashes across repeated runs", async () => {
    const source = `
      function transform({ a, b: [first, ...rest] = [] }) {
        return first;
      }
    `;
    const first = (await extract(source)).table;
    const second = (await extract(source)).table;

    const firstParams = first.symbols.filter((s) => s.declarationKind === "param");
    const secondParams = second.symbols.filter((s) => s.declarationKind === "param");

    expect(firstParams.length).toBe(3); // a, first, rest
    expect(firstParams.map((p) => p.id)).toEqual(secondParams.map((p) => p.id));
  });
});
