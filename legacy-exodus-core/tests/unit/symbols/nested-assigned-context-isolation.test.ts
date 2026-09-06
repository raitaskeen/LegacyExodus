import { describe, expect, it } from "bun:test";
import { JavaScriptParser, type ParseRequest } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

describe("CodeRabbit #3941957300 — Nested Function Assigned-Context Isolation", () => {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();

  function createRequest(source: string, path = "src/worker.js"): ParseRequest {
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

  async function extract(code: string, sourcePath = "src/worker.js") {
    const parseResponse = await parser.parse(createRequest(code, sourcePath));
    return {
      ast: parseResponse.result!,
      table: extractor.extract(parseResponse.result!),
    };
  }

  // TEST A: Assigned outer function + nested anonymous callback
  it("Scenario A: nested anonymous callback parameter does not inherit outer assigned function identity", async () => {
    const code = `
      class Worker {
        handler = () => {
          [1].forEach((callbackArg) => callbackArg);
        };
      }
    `;
    const { table } = await extract(code);

    const handlerMethod = table.symbols.find((s) => s.kind === "method" && s.name === "handler");
    expect(handlerMethod).toBeDefined();

    const callbackParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "callbackArg");
    expect(callbackParam).toBeDefined();

    // Invariant: Nested anonymous callback parameter must NOT be attributed to outer handler
    expect(callbackParam?.containerName).toBeUndefined();
    expect(callbackParam?.containerId).toBeUndefined();
  });

  // TEST B: Assigned outer function's own parameter retains correct container
  it("Scenario B: assigned outer function's own parameter correctly belongs to the assigned method", async () => {
    const code = `
      class Worker {
        handler = (value) => value;
      }
    `;
    const { table } = await extract(code);

    const handlerMethod = table.symbols.find((s) => s.kind === "method" && s.name === "handler");
    expect(handlerMethod).toBeDefined();

    const valueParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "value");
    expect(valueParam).toBeDefined();
    expect(valueParam?.containerName).toBe("handler");
    expect(valueParam?.containerId).toBe(handlerMethod?.id);
  });

  // TEST C: Nested named function inside assigned function belongs to itself, not outer assigned function
  it("Scenario C: nested named function parameter belongs to inner function, not outer assigned method", async () => {
    const code = `
      class Worker {
        handler = (outerParam) => {
          function inner(innerArg) {
            return innerArg;
          }
          return inner(outerParam);
        };
      }
    `;
    const { table } = await extract(code);

    const handlerMethod = table.symbols.find((s) => s.kind === "method" && s.name === "handler");
    const innerFn = table.symbols.find((s) => s.kind === "function" && s.name === "inner");
    expect(handlerMethod).toBeDefined();
    expect(innerFn).toBeDefined();

    const outerParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "outerParam");
    const innerParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "innerArg");

    expect(outerParam).toBeDefined();
    expect(outerParam?.containerName).toBe("handler");
    expect(outerParam?.containerId).toBe(handlerMethod?.id);

    expect(innerParam).toBeDefined();
    expect(innerParam?.containerName).toBe("inner");
    expect(innerParam?.containerId).toBe(innerFn?.id);
  });

  // TEST D: Nested function expression / callback inside assigned function
  it("Scenario D: nested function expression parameter does not inherit outer assigned method identity", async () => {
    const code = `
      class Worker {
        handler = function(req) {
          setTimeout(function(timeoutArg) {
            return timeoutArg;
          }, 100);
        };
      }
    `;
    const { table } = await extract(code);

    const handlerMethod = table.symbols.find((s) => s.kind === "method" && s.name === "handler");
    expect(handlerMethod).toBeDefined();

    const reqParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "req");
    expect(reqParam).toBeDefined();
    expect(reqParam?.containerName).toBe("handler");
    expect(reqParam?.containerId).toBe(handlerMethod?.id);

    const timeoutParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "timeoutArg");
    expect(timeoutParam).toBeDefined();
    expect(timeoutParam?.containerName).toBeUndefined();
    expect(timeoutParam?.containerId).toBeUndefined();
  });

  // TEST E: Normal class method behavior is preserved without regression
  it("Scenario E: normal class method parameters and callbacks preserve standard behavior", async () => {
    const code = `
      class Worker {
        process(input) {
          return [input].map((item) => item);
        }
      }
    `;
    const { table } = await extract(code);

    const processMethod = table.symbols.find((s) => s.kind === "method" && s.name === "process");
    expect(processMethod).toBeDefined();

    const inputParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "input");
    expect(inputParam).toBeDefined();
    expect(inputParam?.containerName).toBe("process");
    expect(inputParam?.containerId).toBe(processMethod?.id);

    const itemParam = table.symbols.find((s) => s.declarationKind === "param" && s.name === "item");
    expect(itemParam).toBeDefined();
    expect(itemParam?.containerName).toBeUndefined();
    expect(itemParam?.containerId).toBeUndefined();
  });

  // TEST F: Curried assigned arrow function does not leak outer property name to inner returned arrow function
  it("Scenario F: curried arrow function parameter does not inherit assigned property identity", async () => {
    const code = `
      class Worker {
        curried = (a) => (b) => a + b;
      }
    `;
    const { table } = await extract(code);

    const curriedMethod = table.symbols.find((s) => s.kind === "method" && s.name === "curried");
    expect(curriedMethod).toBeDefined();

    const paramA = table.symbols.find((s) => s.declarationKind === "param" && s.name === "a");
    const paramB = table.symbols.find((s) => s.declarationKind === "param" && s.name === "b");

    expect(paramA).toBeDefined();
    expect(paramA?.containerName).toBe("curried");
    expect(paramA?.containerId).toBe(curriedMethod?.id);

    expect(paramB).toBeDefined();
    expect(paramB?.containerName).toBeUndefined();
    expect(paramB?.containerId).toBeUndefined();
  });
});
