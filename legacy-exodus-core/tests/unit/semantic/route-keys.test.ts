import { describe, expect, test } from "bun:test";

import { JavaScriptParser } from "@parser/index";
import { findHttpCalls } from "@semantic/semantic-engine";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

/** ADR-008: routes and middleware chains are keyed by owners, method and path, never by line or index. */

async function analyze(source: string): Promise<{ readonly routes: string[]; readonly chains: string[] }> {
  const path = "src/server.js";
  const ast = (await new JavaScriptParser().parse({ file: { id: path, path, language: "javascript", size: source.length }, source })).result;
  const result = findHttpCalls(ast.root, path, new JavaScriptSymbolExtractor().extract(ast));
  return { routes: result.routes.map((route) => route.key ?? "<missing>"), chains: result.middlewareChains.map((chain) => chain.key ?? "<missing>") };
}

const server = [
  "const express = require('express');",
  "const app = express();",
  "const api = express.Router();",
  "app.use(express.json());",
  "api.get('/items', (req, res) => res.json([]));",
  "app.use('/v1', api);",
  "app.use('/v2', api);",
  "app.post('/login', (req, res) => res.end());",
  "app.post('/login', (req, res) => res.end());",
  "app.get(/^\\/a$/, (req, res) => res.end());",
  "app.get(/^\\/b$/, (req, res) => res.end());",
  "",
].join("\n");

describe("route and middleware keys (ADR-008)", () => {
  test("name the method and each full mounted path; a repeat keeps the first key plain", async () => {
    expect((await analyze(server)).routes).toEqual([
      "src/server.js#route:POST /login",
      "src/server.js#route:POST /login~1",
      "src/server.js#route:GET <dynamic>",
      "src/server.js#route:GET <dynamic>~1",
      "src/server.js#route:GET /v1/items",
      "src/server.js#route:GET /v2/items",
    ]);
    expect((await analyze(server)).chains).toEqual(["src/server.js#middleware:app"]);
  });

  test("are unchanged by lines, statements and a different route added above", async () => {
    const keys = await analyze(server);
    expect(await analyze(`// header\n\n${server}`)).toEqual(keys);
    expect(await analyze(`function unrelated() {}\n${server}`)).toEqual(keys);
    const withRoute = await analyze(server.replace("app.use(express.json());", "app.use(express.json());\napp.get('/health', (req, res) => res.end());"));
    expect(withRoute.routes.filter((key) => !key.endsWith("GET /health"))).toEqual(keys.routes);
  });

  test("appending a repeat leaves the existing key unchanged", async () => {
    const appended = await analyze(`${server}app.post('/login', (req, res) => res.end());\n`);
    expect(appended.routes).toEqual(expect.arrayContaining(["src/server.js#route:POST /login", "src/server.js#route:POST /login~1", "src/server.js#route:POST /login~2"]));
  });

  test("the same path registered in two functions is told apart by its owner, not by order", async () => {
    const source = [
      "const express = require('express');",
      "function mountA(app) { app.get('/x', (req, res) => res.end()); }",
      "function mountB() { const app = express(); app.get('/x', (req, res) => res.end()); return app; }",
      "function mountC() { const app = express(); app.get('/x', (req, res) => res.end()); return app; }",
      "",
    ].join("\n");
    const keys = (await analyze(source)).routes;
    expect(keys).toEqual(expect.arrayContaining(["src/server.js#mountB:function/route:GET /x", "src/server.js#mountC:function/route:GET /x"]));
    const swapped = source.split("\n");
    [swapped[2], swapped[3]] = [swapped[3]!, swapped[2]!];
    expect((await analyze(swapped.join("\n"))).routes.sort()).toEqual([...keys].sort());
  });
});
