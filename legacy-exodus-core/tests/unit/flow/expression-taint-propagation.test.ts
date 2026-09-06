import { describe, expect, test } from "bun:test";
import { DeterministicDataFlowGraphBuilder } from "@flow/index";
import { JavaScriptParser } from "@parser/index";

async function buildDataFlowGraph(id: string, source: string) {
  const ast = (
    await new JavaScriptParser().parse({
      file: { id, path: `src/${id}.js`, language: "javascript", size: source.length },
      source,
    })
  ).result;
  return new DeterministicDataFlowGraphBuilder().build(ast);
}

describe("Expression-based taint propagation", () => {
  test("1. binary concatenation with direct source propagates taint to sink", async (): Promise<void> => {
    const source = `
      const query = "SELECT * FROM users WHERE id = " + req.query.id;
      child_process.exec(query);
    `;
    const graph = await buildDataFlowGraph("binary-direct-source", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
    expect(graph.taintFlows[0]?.state).toBe("CONFIRMED");
  });

  test("2. binary concatenation with tainted variable after clean variable propagates to sink", async (): Promise<void> => {
    const source = `
      const clean = "SELECT * FROM users WHERE id = ";
      const tainted = req.query.id;
      const query = clean + tainted;
      child_process.exec(query);
    `;
    const graph = await buildDataFlowGraph("binary-clean-then-tainted", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
    expect(graph.taintFlows[0]?.state).toBe("CONFIRMED");
  });

  test("3. binary concatenation with tainted variable before clean variable propagates to sink", async (): Promise<void> => {
    const source = `
      const tainted = req.query.id;
      const clean = " LIMIT 1";
      const query = tainted + clean;
      child_process.exec(query);
    `;
    const graph = await buildDataFlowGraph("binary-tainted-then-clean", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
    expect(graph.taintFlows[0]?.state).toBe("CONFIRMED");
  });

  test("4. multi-variable binary chain propagates all distinct taint sources", async (): Promise<void> => {
    const source = `
      const pre = "prefix: ";
      const t1 = req.query.user;
      const mid = " password: ";
      const t2 = req.body.pass;
      const post = " end";
      const out = pre + t1 + mid + t2 + post;
      child_process.exec(out);
    `;
    const graph = await buildDataFlowGraph("binary-multi-variable-chain", source);
    expect(graph.taintFlows).toHaveLength(2);
    expect(new Set(graph.taintFlows.map((f) => f.sourceId)).size).toBe(2);
    expect(graph.taintFlows.every((f) => f.path.at(-1) === "child_process.exec")).toBe(true);
  });

  test("5. template literal with embedded direct source propagates to sink", async (): Promise<void> => {
    const source = `
      const query = \`SELECT * FROM users WHERE id = \${req.query.id}\`;
      child_process.exec(query);
    `;
    const graph = await buildDataFlowGraph("template-direct-source", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
    expect(graph.taintFlows[0]?.state).toBe("CONFIRMED");
  });

  test("6. template literal with clean variable and tainted variable propagates to sink", async (): Promise<void> => {
    const source = `
      const clean = "users";
      const tainted = req.query.id;
      const query = \`SELECT * FROM \${clean} WHERE id = \${tainted}\`;
      child_process.exec(query);
    `;
    const graph = await buildDataFlowGraph("template-clean-and-tainted", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("7. logical OR expression with direct source propagates to sink", async (): Promise<void> => {
    const source = `
      const user = req.query.user || "guest";
      child_process.exec(user);
    `;
    const graph = await buildDataFlowGraph("logical-or-direct-source", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("8. logical OR expression with clean fallback and tainted variable propagates to sink", async (): Promise<void> => {
    const source = `
      const clean = null;
      const tainted = req.query.name;
      const name = clean || tainted;
      child_process.exec(name);
    `;
    const graph = await buildDataFlowGraph("logical-or-clean-and-tainted", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("9. conditional ternary expression with direct source in alternate propagates to sink", async (): Promise<void> => {
    const source = `
      const val = condition ? "safe" : req.query.token;
      child_process.exec(val);
    `;
    const graph = await buildDataFlowGraph("ternary-direct-source-alternate", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("10. conditional ternary expression with tainted variable in consequent propagates to sink", async (): Promise<void> => {
    const source = `
      const tainted = req.query.token;
      const val = condition ? tainted : "safe";
      child_process.exec(val);
    `;
    const graph = await buildDataFlowGraph("ternary-tainted-consequent", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("11. array expression with direct source and tainted variable propagates to sink", async (): Promise<void> => {
    const source = `
      const tainted = req.query.tag;
      const list = ["static", req.body.author, tainted];
      const target = list;
      child_process.exec(target);
    `;
    const graph = await buildDataFlowGraph("array-expression-taint", source);
    expect(graph.taintFlows).toHaveLength(2);
    expect(new Set(graph.taintFlows.map((f) => f.sourceId)).size).toBe(2);
    expect(graph.taintFlows.every((f) => f.path.at(-1) === "child_process.exec")).toBe(true);
  });

  test("12. object expression with direct source and tainted variable propagates to sink", async (): Promise<void> => {
    const source = `
      const tainted = req.query.tag;
      const payload = { safe: "ok", author: req.body.author, tag: tainted };
      const target = payload;
      child_process.exec(target);
    `;
    const graph = await buildDataFlowGraph("object-expression-taint", source);
    expect(graph.taintFlows).toHaveLength(2);
    expect(new Set(graph.taintFlows.map((f) => f.sourceId)).size).toBe(2);
    expect(graph.taintFlows.every((f) => f.path.at(-1) === "child_process.exec")).toBe(true);
  });

  test("13. sanitizer boundary in binary concatenation blocks taint propagation", async (): Promise<void> => {
    const source = `
      const safe = "Prefix: " + sanitize(req.query.input);
      child_process.exec(safe);
    `;
    const graph = await buildDataFlowGraph("sanitizer-binary", source);
    expect(graph.taintFlows).toEqual([]);
  });

  test("14. sanitizer boundary with validator.escape in template literal blocks taint", async (): Promise<void> => {
    const source = `
      const tainted = req.body.name;
      const safe = \`Hello \${validator.escape(tainted)}\`;
      child_process.exec(safe);
    `;
    const graph = await buildDataFlowGraph("sanitizer-template-validator", source);
    expect(graph.taintFlows).toEqual([]);
  });

  test("15. mixed sanitized and unsanitized expressions preserve only genuine taint", async (): Promise<void> => {
    const source = `
      const t1 = req.query.a;
      const t2 = req.body.b;
      const mixed = sanitize(t1) + " : " + t2;
      child_process.exec(mixed);
    `;
    const graph = await buildDataFlowGraph("mixed-sanitized-unsanitized", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("16. composite expression directly inside sink arguments propagates taint", async (): Promise<void> => {
    const source = `
      const clean = "user: ";
      const tainted = req.query.name;
      child_process.exec(clean + tainted);
    `;
    const graph = await buildDataFlowGraph("sink-direct-expression-argument", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("17. composite expression containing unresolved call propagates taint", async (): Promise<void> => {
    const source = `
      const tainted = req.body.name;
      const out = "Prefix: " + unknownTransform(tainted);
      child_process.exec(out);
    `;
    const graph = await buildDataFlowGraph("expression-with-call", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("18. deterministic output across multiple runs with composite expressions", async (): Promise<void> => {
    const source = `
      const a = req.query.a;
      const b = req.body.b;
      const query = \`prefix \${a} \${b} \${"constant"}\`;
      child_process.exec(query);
    `;
    const run1 = await buildDataFlowGraph("determinism-1", source);
    const run2 = await buildDataFlowGraph("determinism-1", source);
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });
});
