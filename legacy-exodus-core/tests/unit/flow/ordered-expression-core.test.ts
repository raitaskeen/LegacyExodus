import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { DeterministicDataFlowGraphBuilder, type BuildContextResult } from "@flow/index";
import { JavaScriptParser, type ASTNode } from "@parser/index";

const filePath = "src/ordered-core.js";
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const definitionId = (name: string, kind: string, position: string): string =>
  hash(`definition:${filePath}:${name}:${kind}:${position}`);

async function parse(source: string) {
  const ast = (await new JavaScriptParser().parse({
    file: { id: "ordered-core", path: filePath, language: "javascript", size: source.length },
    source,
  })).result;
  expect(ast.errors).toEqual([]);
  return ast;
}

async function analyze(source: string): Promise<BuildContextResult> {
  return new DeterministicDataFlowGraphBuilder().buildContext(await parse(source));
}

function sourceFor(statement: string, sink = "x"): string {
  return `let x = req.query.x;\nlet y = 2;\n${statement}\nchild_process.exec(${sink});`;
}

/**
 * Wave 3b: the CFG taint verdict adds flows the legacy transfers miss, with path `[source, sink]`
 * (a legacy path always passes a definition). The golden hashes cover the legacy graph; these
 * additions are asserted on their own. Each is a real runtime flow: `x` holds `req.query.x`
 * (or a value derived from it) at the sink, on every path (CONFIRMED) or on some (INFERRED).
 */
const cfgAddedFlows: Readonly<Record<string, string>> = {
  "x = (x = x + 1, unknownFunction(x));": "CONFIRMED",
  "x = (x = x + 1, { value: x });": "CONFIRMED",
  "x = (x = x + 1, [x, ...items]);": "CONFIRMED",
  "x = (x = x + 1, x && y);": "INFERRED",
  "x = (x = x + 1, x ? y : x);": "INFERRED",
  "x = (x = x + 1, x++);": "CONFIRMED",
  "x = (x = x + 1, -x);": "CONFIRMED",
  "x = (x = x + 1, obj.value = x);": "CONFIRMED",
  "x &&= x + 1;": "CONFIRMED",
  "x ||= x + 1;": "CONFIRMED",
  "x ??= x + 1;": "CONFIRMED",
  "const result = (x = x + 1);": "CONFIRMED",
  "consume(x = x + 1);": "CONFIRMED",
  "x + (x = x + 1);": "CONFIRMED",
};

function legacyHash(result: BuildContextResult): string {
  const graph = { ...result.graph, taintFlows: result.graph.taintFlows.filter((flow) => flow.path.length > 2) };
  // Pinned before fact keys existed (ADR-008): keys are identity, not semantics, so they are left out.
  return hash(JSON.stringify({ graph, transfers: result.state.transfers }, (name, value) => (name === "key" ? undefined : value)));
}

function expectCfgAddedFlows(result: BuildContextResult, statement: string): void {
  const added = result.graph.taintFlows.filter((flow) => flow.path.length === 2).map((flow) => flow.state).join(",");
  expect(added).toBe(cfgAddedFlows[statement.replace(/\s*\/\* note \*\//g, "")] ?? "");
}

function edges(result: BuildContextResult): string[] {
  return result.state.transfers.map((edge) => `${edge.sourceDefinitionId}>${edge.targetDefinitionId}`).sort();
}

function expectIntegrity(result: BuildContextResult): void {
  expect(new Set(edges(result)).size).toBe(result.state.transfers.length);
  expect(result.state.transfers.filter((edge) => edge.sourceDefinitionId === edge.targetDefinitionId)).toEqual([]);
  expect(new Set(result.graph.uses.map((use) => use.id)).size).toBe(result.graph.uses.length);
  expect(new Set(result.graph.definitions.map((definition) => definition.id)).size).toBe(result.graph.definitions.length);
}

const traces = [
  {
    "expression": "x = x + 1",
    "x": [
      "T"
    ],
    "y": [],
    "edges": [
      [
        "T",
        "O"
      ]
    ],
    "tainted": true
  },
  {
    "expression": "x = x + (x = \"safe\")",
    "x": [
      "T"
    ],
    "y": [],
    "edges": [
      [
        "T",
        "O"
      ],
      [
        "I",
        "O"
      ]
    ],
    "tainted": true
  },
  {
    "expression": "x = (x = \"safe\") + x",
    "x": [
      "I"
    ],
    "y": [],
    "edges": [
      [
        "I",
        "O"
      ]
    ],
    "tainted": false
  },
  {
    "expression": "x = (x = \"safe\")",
    "x": [],
    "y": [],
    "edges": [
      [
        "I",
        "O"
      ]
    ],
    "tainted": false
  },
  {
    "expression": "x = (x = \"safe\", x)",
    "x": [
      "I"
    ],
    "y": [],
    "edges": [
      [
        "I",
        "O"
      ]
    ],
    "tainted": false
  },
  {
    "expression": "x = (x, x = \"safe\")",
    "x": [
      "T"
    ],
    "y": [],
    "edges": [
      [
        "I",
        "O"
      ]
    ],
    "tainted": false
  },
  {
    "expression": "x = [x, x = \"safe\"]",
    "x": [
      "T"
    ],
    "y": [],
    "edges": [
      [
        "T",
        "O"
      ],
      [
        "I",
        "O"
      ]
    ],
    "tainted": true
  },
  {
    "expression": "x = [x = \"safe\", x]",
    "x": [
      "I"
    ],
    "y": [],
    "edges": [
      [
        "I",
        "O"
      ]
    ],
    "tainted": false
  },
  {
    "expression": "x += y",
    "x": [
      "T"
    ],
    "y": [
      "Y"
    ],
    "edges": [
      [
        "T",
        "O"
      ],
      [
        "Y",
        "O"
      ]
    ],
    "tainted": true
  },
  {
    "expression": "x += (x = \"safe\")",
    "x": [
      "T"
    ],
    "y": [],
    "edges": [
      [
        "T",
        "O"
      ],
      [
        "I",
        "O"
      ]
    ],
    "tainted": true
  },
  {
    "expression": "y = x",
    "x": [
      "T"
    ],
    "y": [],
    "edges": [
      [
        "T",
        "O"
      ]
    ],
    "tainted": true
  }
] as const;

describe("F01-CORE ordered value capture", () => {
  for (const trace of traces) {
    const target = trace.expression.startsWith("y =") ? "y" : "x";
    const nestedColumn = trace.expression.indexOf('x = "safe"', 1);
    const ids: Readonly<Record<string, string>> = {
      T: definitionId("x", "declaration", "1:4"),
      Y: definitionId("y", "declaration", "2:4"),
      I: definitionId("x", "assignment", `3:${nestedColumn}`),
      O: definitionId(target, "assignment", "3:0"),
    };

    const requireId = (key: string): string => {
      const value = ids[key];
      if (value === undefined) throw new Error(`Missing trace definition ID: ${key}`);
      return value;
    };

    test(`uses and transfers: ${trace.expression}`, async () => {
      const result = await analyze(sourceFor(`${trace.expression};`, target));
      const expectedX = [...trace.x.map((key) => requireId(key)), ...(target === "x" ? [requireId("O")] : [])];
      const expectedY = [...trace.y.map((key) => requireId(key)), ...(target === "y" ? [requireId("O")] : [])];
      expect(result.graph.uses.filter((use) => use.name === "x").map((use) => use.definitionId).sort()).toEqual(expectedX.sort());
      expect(result.graph.uses.filter((use) => use.name === "y").map((use) => use.definitionId).sort()).toEqual(expectedY.sort());
      expect(edges(result)).toEqual(trace.edges.map(([from, to]) => `${requireId(from)}>${requireId(to)}`).sort());
      // The final sink must see the outer publication, including after nested writes.
      expect(result.state.sinks.map((sink) => sink.argumentDefinitionIds)).toEqual([[requireId("O")]]);
      expect(result.graph.definitions.find((definition) => definition.id === requireId("O"))?.constantValue).toBeUndefined();
      expectIntegrity(result);
    });

    test(`taint: ${trace.expression}`, async () => {
      const result = await analyze(sourceFor(`${trace.expression};`, target));
      if (trace.tainted) {
        const sourceId = hash(`source:${filePath}:req.query.x:1:8`);
        expect(result.graph.taintFlows.map((flow) => ({ sourceId: flow.sourceId, path: flow.path, state: flow.state })))
          .toEqual([{ sourceId, path: [sourceId, requireId("T"), requireId("O"), "child_process.exec"], state: "CONFIRMED" }]);
      } else {
        expect(result.graph.taintFlows).toEqual([]);
      }
    });
  }

  test("copying x leaves its binding unchanged", async () => {
    const result = await analyze(sourceFor("y = x; child_process.exec(y);"));
    const initial = definitionId("x", "declaration", "1:4");
    const copied = definitionId("y", "assignment", "3:0");
    expect(result.graph.uses.filter((use) => use.name === "x").map((use) => use.definitionId)).toEqual([initial, initial]);
    expect(result.graph.uses.filter((use) => use.name === "y").map((use) => use.definitionId)).toEqual([copied]);
    expect(result.graph.taintFlows.map((flow) => flow.path.slice(1, -1)).sort())
      .toEqual([[initial], [initial, copied]].sort());
  });

  test("array holes do not discard captured elements or evaluate twice", async () => {
    const result = await analyze(sourceFor('x = [x, , x = "safe", x];'));
    const initial = definitionId("x", "declaration", "1:4");
    const outer = definitionId("x", "assignment", "3:0");
    const inner = definitionId("x", "assignment", "3:10");
    expect(edges(result)).toEqual([`${initial}>${outer}`, `${inner}>${outer}`].sort());
    expect(result.graph.uses.filter((use) => use.name === "x").map((use) => use.definitionId).sort())
      .toEqual([initial, inner, outer].sort());
    expectIntegrity(result);
  });

  test("repeated operand values produce one transfer without losing uses", async () => {
    const result = await analyze(sourceFor("x = x + x + x;"));
    const initial = definitionId("x", "declaration", "1:4");
    const outer = definitionId("x", "assignment", "3:0");
    expect(edges(result)).toEqual([`${initial}>${outer}`]);
    expect(result.graph.uses.filter((use) => use.name === "x").map((use) => use.definitionId).sort())
      .toEqual([initial, initial, initial, outer].sort());
    expectIntegrity(result);
  });

  test("a nested direct source retains its own source location", async () => {
    const result = await analyze(sourceFor("x = (x = req.body.value);"));
    const outer = definitionId("x", "assignment", "3:0");
    const inner = definitionId("x", "assignment", "3:5");
    const sourceId = hash(`source:${filePath}:req.body.value:3:9`);
    expect(edges(result)).toEqual([`${inner}>${outer}`]);
    expect(result.graph.taintFlows.map((flow) => flow.path))
      .toEqual([[sourceId, inner, outer, "child_process.exec"]]);
    expectIntegrity(result);
  });

  test("discarded sequence sources are not final-value dependencies", async () => {
    const result = await analyze(sourceFor('x = (req.body.value, "safe");'));
    expect(result.graph.taintFlows).toEqual([]);
    expect(edges(result)).toEqual([]);
    expect(result.graph.uses.filter((use) => use.name === "req.body.value")).toHaveLength(1);
  });

  test("static members preserve full-path-before-base dependency policy", async () => {
    const result = await analyze('let obj = req.query.x; obj.value = "safe"; let x; x = obj.value; child_process.exec(x);');
    const property = result.graph.definitions.find((definition) => definition.name === "obj.value");
    const outer = result.graph.definitions.find((definition) => definition.name === "x" && definition.kind === "assignment");
    if (property === undefined || outer === undefined) throw new Error("Missing member fixture definition");
    expect(edges(result)).toEqual([`${property.id}>${outer.id}`]);
    expect(result.graph.uses.filter((use) => use.name === "obj.value").map((use) => use.definitionId)).toEqual([property.id]);
    expect(result.graph.taintFlows).toEqual([]);
  });

  for (const literal of ['"safe"', "7", "false", "null"]) {
    test(`preserves baseline literal-only constant reporting: ${literal}`, async () => {
      const result = await analyze(sourceFor(`x = ${literal};`));
      const ast = await parse(sourceFor(`x = ${literal};`));
      const statement = ast.root.children.find((node) => node.type === "ExpressionStatement");
      const rhs = statement?.children[0]?.children.find((node) => node.role === "right");
      const value = rhs?.attributes.value;
      const expected = typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : undefined;
      expect(result.graph.definitions.find((definition) => definition.kind === "assignment")?.constantValue).toBe(expected);
      expect(result.graph.taintFlows).toEqual([]);
    });
  }

  test("anonymous definition allocation remains outer-before-inner", async () => {
    const ast = await parse(sourceFor('x = (x = "safe");'));
    const withoutLocations = (node: ASTNode): ASTNode => {
      const { location: _location, ...rest } = node;
      return { ...rest, children: node.children.map(withoutLocations) };
    };
    const result = new DeterministicDataFlowGraphBuilder().buildContext({ ...ast, root: withoutLocations(ast.root) });
    const outer = definitionId("x", "assignment", "anon-2");
    const inner = definitionId("x", "assignment", "anon-3");
    expect(edges(result)).toEqual([`${inner}>${outer}`]);
    expect(result.state.sinks.map((sink) => sink.argumentDefinitionIds)).toEqual([[outer]]);
    expect(result.graph.taintFlows).toEqual([]);
  });

  test("repeated ordered builds have identical complete graphs and transfers", async () => {
    const source = sourceFor('x = [x, x = "safe", x]; x += (x = req.body.value);');
    const first = await analyze(source);
    for (let run = 0; run < 3; run++) {
      const next = await analyze(source);
      expect(next.graph).toEqual(first.graph);
      expect(next.state.transfers).toEqual(first.state.transfers);
      expectIntegrity(next);
    }
  });
});

// Frozen-baseline fingerprints protect the legacy path, including an eligible
// prefix before a disallowed sibling: preflight must reject before any effects.
const legacyFixtures = [
  [
    "x = (x = x + 1, unknownFunction(x));",
    "d55270a57d98e594b4dee5cb3ef5a1b4f17a1208611b9b32dab57cf12312c1ff"
  ],
  [
    "x = (x = x + 1, { value: x });",
    "6501d29c379106f0479be27ab7094f36ef3ff8b2a6553506a56fefff2188fb37"
  ],
  [
    "x = (x = x + 1, [x, ...items]);",
    "31b704b670a1df5c1aaa71f69ae5f9b58de3c18ea6ee3ef616c9301fc9453739"
  ],
  [
    "x = (x = x + 1, x && y);",
    "e7c2d9ea83189010200b727694f3e0986c9848a8faeeb5623f9085addd446074"
  ],
  [
    "x = (x = x + 1, x ? y : x);",
    "e10bb6b8f6cf23e8d1148c978445e11120099ffbecde9e6d0b56ea4e1b50b79a"
  ],
  [
    "x = (x = x + 1, x++);",
    "59e6de490b3429e3c2fd3a677e13d0b99bd2d723030bc05fba0ef182dcde5ade"
  ],
  [
    "x = (x = x + 1, -x);",
    "83d775ee3fbdf440aeb6ec874024fb4bfa8b91cfc39c86483744f09387a014a7"
  ],
  [
    "x = (x = x + 1, obj[\"value\"]);",
    "870531893869bd2b434416ccd8bb4d79368fd9f8b04560b18b7bfa09f8c47fbf"
  ],
  [
    "x = (x = x + 1, obj.value = x);",
    "7b4ed6f0a21444856df22ad280067b27827dc4cf73ccdaf836d785cb530a22a1"
  ],
  [
    "x &&= x + 1;",
    "8d8791315a5f4c1c1e2d69ebc422a881cc50f0bfd0953a66186b4447292efdca"
  ],
  [
    "x ||= x + 1;",
    "8d8791315a5f4c1c1e2d69ebc422a881cc50f0bfd0953a66186b4447292efdca"
  ],
  [
    "x ??= x + 1;",
    "8d8791315a5f4c1c1e2d69ebc422a881cc50f0bfd0953a66186b4447292efdca"
  ],
  [
    "[x] = [x];",
    "F01-FULL:transfer"
  ],
  [
    "({ x } = { x });",
    "F01-FULL:transfer"
  ],
  [
    "obj.value = x + 1;",
    "b36243df060fed9dac40a4c672d44e9fa31e94920f70c7f68d35e25be0fb804a"
  ],
  [
    "const result = (x = x + 1);",
    "796e3a0fca540ab66cb3ada446e1028d050163b5a017bc61d28436b0b56bf02f"
  ],
  [
    "consume(x = x + 1);",
    "bf198e610037eb0a8c64c568ef44013014532e49f662e44f03a22d137492c10c"
  ],
  [
    "function read() { return x = x + 1; }",
    "9368e38c936544681aedd05864dcc0132bffbf65e25bb2dd5e34a242c2274da7"
  ],
  [
    "x + (x = x + 1);",
    "0aead35c88d06a9181086c8d040ed01813a91e2738e6509669d747169334322b"
  ],
  [
    "x = sanitize(x);",
    "F01-FULL:sanitizer"
  ],
  [
    "x = validator.escape(x);",
    "F01-FULL:sanitizer"
  ]
] as const;

describe("F01-CORE whole-statement fallback and consumer boundary", () => {
  for (const [statement, expected] of legacyFixtures) {
    test(statement, async () => {
      const result = await analyze(sourceFor(statement));
      if (expected.startsWith("F01-FULL:")) {
        const incoming = definitionId("x", "declaration", "1:4");
        const receiver = definitionId("x", "assignment", statement.startsWith("(") ? "3:1" : "3:0");
        expectRt01Use(result, "x", `3:${statement.lastIndexOf("x")}`, incoming);
        expectRt01Use(result, "x", "4:19", receiver);
        expect(result.state.sinks.map((sink) => sink.argumentDefinitionIds)).toEqual([[receiver]]);
        expect(edges(result)).toEqual(expected === "F01-FULL:transfer" ? [`${incoming}>${receiver}`] : []);
        expect(result.graph.taintFlows).toHaveLength(expected === "F01-FULL:transfer" ? 1 : 0);
        expectIntegrity(result);
      } else {
        expect(legacyHash(result)).toBe(expected);
        expectCfgAddedFlows(result, statement);
      }
    });
  }
});

interface Rt01Fixture {
  readonly name: string;
  readonly statement: string;
  readonly reads: readonly (readonly [marker: string, definition: string])[];
  readonly transfers: readonly (readonly [from: string, to: string])[];
  readonly tainted: boolean;
  readonly nested?: boolean;
  readonly member?: boolean;
  readonly directSource?: boolean;
}

const rt01Fixtures: readonly Rt01Fixture[] = [
  { name: "A trailing statement", statement: "[[O]]x = [[r0]]x + 1; /* note */", reads: [["r0", "T"]], transfers: [["T", "O"]], tainted: true },
  { name: "B leading statement", statement: "// note\n[[O]]x = [[r0]]x + 1;", reads: [["r0", "T"]], transfers: [["T", "O"]], tainted: true },
  { name: "C inline RHS", statement: "[[O]]x = [[r0]]x /* note */ + 1;", reads: [["r0", "T"]], transfers: [["T", "O"]], tainted: true },
  { name: "D literal operand", statement: "[[O]]x = [[r0]]x + /* note */ 1;", reads: [["r0", "T"]], transfers: [["T", "O"]], tainted: true },
  { name: "E nested overwrite", statement: '[[O]]x = [[r0]]x + ([[I]]x = "safe" /* note */);', reads: [["r0", "T"]], transfers: [["T", "O"], ["I", "O"]], tainted: true, nested: true },
  { name: "F reverse nested overwrite", statement: '[[O]]x = ([[I]]x = "safe" /* note */) + [[r0]]x;', reads: [["r0", "I"]], transfers: [["I", "O"]], tainted: false, nested: true },
  { name: "G sequence discarded read", statement: '[[O]]x = ([[r0]]x /* note */, [[I]]x = "safe");', reads: [["r0", "T"]], transfers: [["I", "O"]], tainted: false, nested: true },
  { name: "H array captured read", statement: '[[O]]x = [[[r0]]x /* note */, [[I]]x = "safe"];', reads: [["r0", "T"]], transfers: [["T", "O"], ["I", "O"]], tainted: true, nested: true },
  { name: "I compound RHS", statement: "[[O]][[r0]]x += /* note */ [[r1]]y;", reads: [["r0", "T"], ["r1", "Y"]], transfers: [["T", "O"], ["Y", "O"]], tainted: true },
  { name: "J nested compound overwrite", statement: '[[O]][[r0]]x += ([[I]]x = "safe" /* note */);', reads: [["r0", "T"]], transfers: [["T", "O"], ["I", "O"]], tainted: true, nested: true },
  { name: "multiple operand comments", statement: "[[O]]x = /* a */ /* b */ [[r0]]x /* c */ /* d */ + 1;", reads: [["r0", "T"]], transfers: [["T", "O"]], tainted: true },
  { name: "leading and trailing with LHS comment", statement: "/* before */ [[O]]x /* lhs */ = [[r0]]x + 1; /* after */", reads: [["r0", "T"]], transfers: [["T", "O"]], tainted: true },
  { name: "binary parent comments", statement: "[[O]]x = (/* before */ [[r0]]x + 1 /* after */);", reads: [["r0", "T"]], transfers: [["T", "O"]], tainted: true },
  { name: "sequence parent comments", statement: '[[O]]x = (/* before */ [[r0]]x, [[I]]x = "safe" /* after */);', reads: [["r0", "T"]], transfers: [["I", "O"]], tainted: false, nested: true },
  { name: "array holes and inner comments", statement: '[[O]]x = [/* first hole */, [[r0]]x, /* second hole */, [[I]]x = "safe", [[r1]]x];', reads: [["r0", "T"], ["r1", "I"]], transfers: [["T", "O"], ["I", "O"]], tainted: true, nested: true },
  { name: "empty commented array", statement: "[[O]]x = [/* inner */];", reads: [], transfers: [], tainted: false },
  { name: "static member comments", statement: "[[O]]x = [[r0]]obj /* object */ . /* property */ value + [[r1]]x;", reads: [["r0", "B"], ["r1", "T"]], transfers: [["B", "O"], ["T", "O"]], tainted: true, member: true },
  { name: "nested direct source comments", statement: "[[O]]x = ([[I]]x = [[S2]]req. /* source */ body.value /* nested */);", reads: [], transfers: [["I", "O"]], tainted: true, nested: true, directSource: true },
];

function rt01Source(fixture: Rt01Fixture): { readonly source: string; readonly position: (marker: string) => string } {
  const marked = `let [[T]]x = [[S]]req.query.x;\nlet [[Y]]y = 2;\n${fixture.member ? 'let [[B]]obj = "safe";\n' : ""}${fixture.statement}\nchild_process.exec([[K]]x);`;
  const positions = new Map<string, string>();
  let source = "";
  let cursor = 0;
  for (const match of marked.matchAll(/\[\[([A-Za-z][A-Za-z0-9]*)\]\]/g)) {
    const marker = match[1];
    if (marker === undefined || positions.has(marker)) throw new Error("Invalid or repeated RT-01 marker");
    source += marked.slice(cursor, match.index);
    const lines = source.split("\n");
    positions.set(marker, `${lines.length}:${lines[lines.length - 1]?.length ?? 0}`);
    cursor = match.index + match[0].length;
  }
  source += marked.slice(cursor);
  return {
    source,
    position(marker) {
      const position = positions.get(marker);
      if (position === undefined) throw new Error(`Missing RT-01 marker: ${marker}`);
      return position;
    },
  };
}

// These fixed fixtures contain no comment delimiters in strings. Preserve every
// executable coordinate so the comment-free control must retain exact IDs.
function rt01WithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (comment) => comment.replace(/[^\r\n]/g, " "));
}

function expectRt01Use(result: BuildContextResult, name: string, position: string, expectedDefinitionId: string | undefined): void {
  const id = hash(`use:${filePath}:${name}:${position}`);
  const matches = result.graph.uses.filter((use) => use.id === id);
  expect(matches).toHaveLength(1);
  expect(matches[0]?.definitionId).toBe(expectedDefinitionId);
}

function expectRt01Semantics(result: BuildContextResult, fixture: Rt01Fixture, position: (marker: string) => string): void {
  const definitions: { marker: string; name: string; kind: "declaration" | "assignment" }[] = [
    { marker: "T", name: "x", kind: "declaration" },
    { marker: "Y", name: "y", kind: "declaration" },
    { marker: "O", name: "x", kind: "assignment" },


  ];
  if (fixture.nested) definitions.push({ marker: "I", name: "x", kind: "assignment" });
  if (fixture.member) definitions.push({ marker: "B", name: "obj", kind: "declaration" });
  const definition = (marker: string) => {
    const item = definitions.find((candidate) => candidate.marker === marker);
    if (item === undefined) throw new Error(`Missing expected RT-01 definition: ${marker}`);
    return { ...item, id: definitionId(item.name, item.kind, position(marker)) };
  };
  for (const [marker, binding] of [...fixture.reads, ["K", "O"] as const]) {
    const expected = definition(binding);
    expectRt01Use(result, expected.name, position(marker), expected.id);
  }
  expectRt01Use(result, "req.query.x", position("S"), undefined);
  expectRt01Use(result, "req", position("S"), undefined);
  if (fixture.member) expectRt01Use(result, "obj.value", position("r0"), undefined);
  if (fixture.directSource) {
    expectRt01Use(result, "req.body.value", position("S2"), undefined);
    expectRt01Use(result, "req", position("S2"), undefined);
  }
  expect(result.graph.uses.filter((use) => ["x", "y", "obj", "obj.value"].includes(use.name)))
    .toHaveLength(fixture.reads.length + 1 + (fixture.member ? 1 : 0));
  expect(result.graph.definitions.map(({ id, name, kind }) => ({ id, name, kind })))
    .toEqual(definitions.map(({ marker }) => {
      const { id, name, kind } = definition(marker);
      return { id, name, kind };
    }).sort((left, right) => left.id.localeCompare(right.id)));
  expect(edges(result)).toEqual(fixture.transfers.map(([from, to]) => `${definition(from).id}>${definition(to).id}`).sort());
  expect(result.state.transfers).toHaveLength(fixture.transfers.length);
  expect(result.state.sinks.map((sink) => sink.argumentDefinitionIds)).toEqual([[definition("O").id]]);
  const sourceMarker = fixture.directSource ? "S2" : "S";
  const sourcePath = fixture.directSource ? "req.body.value" : "req.query.x";
  const sourceId = hash(`source:${filePath}:${sourcePath}:${position(sourceMarker)}`);
  const origin = definition(fixture.directSource ? "I" : "T").id;
  expect(result.graph.taintFlows.map(({ sourceId, path, state }) => ({ sourceId, path, state })))
    .toEqual(fixture.tainted ? [{ sourceId, path: [sourceId, origin, definition("O").id, "child_process.exec"], state: "CONFIRMED" }] : []);
  expectIntegrity(result);
}

// Captured against the frozen pre-RT-01 candidate before changing production.
const rt01Fallbacks = [
  ["x = (x = x + 1, unknownFunction(x) /* note */);", "d55270a57d98e594b4dee5cb3ef5a1b4f17a1208611b9b32dab57cf12312c1ff"],
  ["x = (x = x + 1, { value: x /* note */ });", "6501d29c379106f0479be27ab7094f36ef3ff8b2a6553506a56fefff2188fb37"],
  ["x = (x = x + 1, x /* note */ && y);", "79e1d5ad9e932513f0b73127b5e8a21c36b22c18cc8ce3d382c34271b7838a4c"],
  ["x = (x = x + 1, x ? /* note */ y : x);", "26b72281ba258d45cd3a14578c7842a0020fdfb005f77dd8cd190db5eef1c8c6"],
  ["x = (x = x + 1, x++ /* note */);", "59e6de490b3429e3c2fd3a677e13d0b99bd2d723030bc05fba0ef182dcde5ade"],
  ["x = (x = x + 1, [x, ...items /* note */]);", "31b704b670a1df5c1aaa71f69ae5f9b58de3c18ea6ee3ef616c9301fc9453739"],
  ["obj.value /* note */ = x + 1;", "b78b7f477a305efd7c6a388887fdbc460471a03e17ebdb1ee6d84b403e537156"],
] as const;

describe("RT-01 comment metadata", () => {
  for (const fixture of rt01Fixtures) {
    test(fixture.name, async () => {
      const { source, position } = rt01Source(fixture);
      const ast = await parse(source);
      const before = JSON.stringify(ast);
      const result = new DeterministicDataFlowGraphBuilder().buildContext(ast);
      expectRt01Semantics(result, fixture, position);
      expect(JSON.stringify(ast)).toBe(before);
      const control = await analyze(rt01WithoutComments(source));
      expectRt01Semantics(control, fixture, position);
      expect(result.graph).toEqual(control.graph);
      expect(result.state.transfers).toEqual(control.state.transfers);
      expect(result.state.taintPaths).toEqual(control.state.taintPaths);
    });
  }

  for (const [statement, expected] of rt01Fallbacks) {
    test(`atomic fallback: ${statement}`, async () => {
      const result = await analyze(sourceFor(statement));
      expect(legacyHash(result)).toBe(expected);
      expectCfgAddedFlows(result, statement);
    });
  }

  test("reused builder preserves located and anonymous comment identities", async () => {
    const builder = new DeterministicDataFlowGraphBuilder();
    const withoutLocations = (node: ASTNode): ASTNode => {
      const { location: _location, ...rest } = node;
      return { ...rest, children: node.children.map(withoutLocations) };
    };
    for (const fixture of rt01Fixtures) {
      const { source } = rt01Source(fixture);
      const ast = await parse(source);
      const plain = await parse(rt01WithoutComments(source));
      for (const locationless of [false, true]) {
        const input = locationless ? { ...ast, root: withoutLocations(ast.root) } : ast;
        const controlInput = locationless ? { ...plain, root: withoutLocations(plain.root) } : plain;
        const control = builder.buildContext(controlInput);
        const before = JSON.stringify(input);
        for (let run = 0; run < 3; run++) {
          const result = builder.buildContext(input);
          expect(result.graph).toEqual(control.graph);
          expect(result.state.transfers).toEqual(control.state.transfers);
          expect(result.state.taintPaths).toEqual(control.state.taintPaths);
          expectIntegrity(result);
          expect(JSON.stringify(input)).toBe(before);
          if (locationless && fixture.nested) {
            const outer = definitionId("x", "assignment", "anon-2");
            const inner = definitionId("x", "assignment", "anon-3");
            expect(result.graph.definitions.map((item) => item.id)).toContain(outer);
            expect(result.graph.definitions.map((item) => item.id)).toContain(inner);
            expect(result.state.sinks.map((sink) => sink.argumentDefinitionIds)).toEqual([[outer]]);
          }
        }
      }
    }
  });
});

// Labels identify source occurrences independently of the graph under test.
function fullSource(marked: string): { source: string; position: (label: string) => string } {
  const positions = new Map<string, string>();
  let source = "";
  let previous = 0;
  for (const match of marked.matchAll(/\[\[([A-Za-z0-9]+)\]\]/g)) {
    source += marked.slice(previous, match.index);
    const lines = source.split("\n");
    positions.set(match[1]!, `${lines.length}:${lines.at(-1)!.length}`);
    previous = match.index + match[0].length;
  }
  source += marked.slice(previous);
  return { source, position: (label) => { const position = positions.get(label); if (position === undefined) throw new Error(label); return position; } };
}

describe("F01-FULL captured call inputs", () => {
  for (const fixture of [
    { name: "unrelated receiver", statement: '[[O]]y = unknownFunction([[R]]x);', receiver: "y", reads: [["R", "T"]], inputs: ["T"], tainted: true },
    { name: "repeated reads", statement: '[[O]]x = unknownFunction([[R]]x, [[S]]x);', receiver: "x", reads: [["R", "T"], ["S", "T"]], inputs: ["T"], tainted: true },
    { name: "nested clean result", statement: '[[O]]x = unknownFunction([[I]]x = "safe");', receiver: "x", reads: [], inputs: ["I"], tainted: false },
    { name: "mixed argument order", statement: '[[O]]x = unknownFunction([[R]]x, [[I]]x = "safe", [[S]]x);', receiver: "x", reads: [["R", "T"], ["S", "I"]], inputs: ["T", "I"], tainted: true },
    { name: "commented sanitizer", statement: '[[O]]x = sanitize(/* before */ [[R]]x /* after */);', receiver: "x", reads: [["R", "T"]], inputs: [], tainted: false },
    { name: "commented escape", statement: '[[O]]x = validator.escape(/* before */ [[R]]x);', receiver: "x", reads: [["R", "T"]], inputs: [], tainted: false },
  ] as const) {
    test(fixture.name, async () => {
      const input = fullSource(`let [[T]]x = req.query.x;\nlet [[Y]]y = 2;\n${fixture.statement}\nchild_process.exec([[K]]${fixture.receiver});`);
      const id = (label: string): string => definitionId(label === "Y" || label === "O" && fixture.receiver === "y" ? "y" : "x", label === "T" || label === "Y" ? "declaration" : "assignment", input.position(label));
      const ast = await parse(input.source);
      const before = JSON.stringify(ast);
      const result = new DeterministicDataFlowGraphBuilder().buildContext(ast);
      for (const [marker, binding] of fixture.reads) expectRt01Use(result, "x", input.position(marker), id(binding));
      expectRt01Use(result, fixture.receiver, input.position("K"), id("O"));
      expect(edges(result)).toEqual(fixture.inputs.map((label) => `${id(label)}>${id("O")}`).sort());
      expect(result.state.sinks.map((sink) => sink.argumentDefinitionIds)).toEqual([[id("O")]]);
      expect(result.graph.taintFlows).toHaveLength(fixture.tainted ? 1 : 0);
      if (fixture.tainted) expect(result.graph.taintFlows[0]?.path).toContain(id("T"));
      expect(JSON.stringify(ast)).toBe(before);
      expectIntegrity(result);
    });
  }
});

describe("F01-FULL complete RHS capture", () => {
  for (const object of [false, true]) {
    for (const clean of [false, true]) {
      test(`${object ? "object" : "array"} ${clean ? "clean overwrite" : "three-way rotation"}`, async () => {
        const statement = object
          ? `([[O]]{ a, b, c } = { a: ${clean ? '"safe"' : '/* old b */ [[R]]b'}, b: [[S]]c, c: [[U]]a });`
          : `[[O]][a, b, c] = [${clean ? '"safe"' : '/* old b */ [[R]]b'}, [[S]]c, [[U]]a];`;
        const input = fullSource(`let [[A]]a = req.query.a;\nlet [[B]]b = "clean";\nlet [[C]]c = req.query.c;\n${statement}\nchild_process.exec([[K]]a);\nchild_process.exec([[L]]b);\nchild_process.exec([[M]]c);`);
        const old = (name: string): string => definitionId(name, "declaration", input.position(name.toUpperCase()));
        const next = (name: string): string => definitionId(name, "assignment", input.position("O"));
        const ast = await parse(input.source);
        const before = JSON.stringify(ast);
        const result = new DeterministicDataFlowGraphBuilder().buildContext(ast);
        if (!clean) expectRt01Use(result, "b", input.position("R"), old("b"));
        expectRt01Use(result, "c", input.position("S"), old("c"));
        expectRt01Use(result, "a", input.position("U"), old("a"));
        for (const [marker, name] of [["K", "a"], ["L", "b"], ["M", "c"]] as const) expectRt01Use(result, name, input.position(marker), next(name));
        expect(edges(result)).toEqual([...(clean ? [] : [`${old("b")}>${next("a")}`]), `${old("c")}>${next("b")}`, `${old("a")}>${next("c")}`].sort());
        expect(result.graph.taintFlows).toHaveLength(2);
        expect(result.graph.taintFlows.map((flow) => flow.path.at(-2)).sort()).toEqual([next("b"), next("c")].sort());
        expect(JSON.stringify(ast)).toBe(before);
        expectIntegrity(result);
      });
    }
  }
});


describe("F01-FULL hostile local-call controls", () => {
  for (const forward of [false, true]) {
    test(`local composite argument preserves every input (forward=${forward})`, async () => {
      const fn = "function identity([[P]]value) { [[V]]return [[R]]value; }";
      const body = 'let [[Y]]y = "clean";\nlet [[T]]x = req.query.x;\n[[O]]x = identity([[A]]y + [[B]]x);\nchild_process.exec([[K]]x);';
      const input = fullSource(forward ? body + "\n" + fn : fn + "\n" + body);
      const result = await analyze(input.source);
      const id = (name: string, kind: string, label: string): string => definitionId(name, kind, input.position(label));
      const old = id("x", "declaration", "T");
      const clean = id("y", "declaration", "Y");
      const parameter = id("value", "parameter", "P");
      const returned = id("identity:return", "return", "V");
      const receiver = id("x", "assignment", "O");
      expectRt01Use(result, "x", input.position("B"), old);
      expectRt01Use(result, "y", input.position("A"), clean);
      expectRt01Use(result, "value", input.position("R"), parameter);
      expectRt01Use(result, "x", input.position("K"), receiver);
      expect(edges(result)).toEqual([`${clean}>${parameter}`, `${old}>${parameter}`, `${parameter}>${returned}`, `${returned}>${receiver}`].sort());
      expect(result.graph.taintFlows).toHaveLength(1);
      expect(result.graph.taintFlows[0]?.path.slice(1)).toEqual([old, parameter, returned, receiver, "child_process.exec"]);
      expectIntegrity(result);
    });
  }
});

describe("F01-FULL hostile literal controls", () => {
  for (const statement of [
    '[[O]][x, y] = [[[A]]x, [[I]]x = "safe"];',
    '([[O]]{ a: x, b: y } = { a: [[A]]x, b: [[I]]x = "safe" });',
    '[[O]][[x], y] = [[[[A]]x], [[I]]x = "safe"];',
  ]) {
    test(statement, async () => {
      const input = fullSource(`let [[T]]x = req.query.x;\nlet y = 2;\n${statement}\nchild_process.exec([[K]]x);\nchild_process.exec([[L]]y);`);
      const old = definitionId("x", "declaration", input.position("T"));
      const nested = definitionId("x", "assignment", input.position("I"));
      const outer = definitionId("x", "assignment", input.position("O"));
      const other = definitionId("y", "assignment", input.position("O"));
      const result = await analyze(input.source);
      expectRt01Use(result, "x", input.position("A"), old);
      expectRt01Use(result, "x", input.position("K"), outer);
      expectRt01Use(result, "y", input.position("L"), other);
      expect(edges(result)).toEqual([`${old}>${outer}`, `${nested}>${other}`].sort());
      expect(result.graph.taintFlows).toHaveLength(1);
      expect(result.graph.taintFlows[0]?.path.slice(1)).toEqual([old, outer, "child_process.exec"]);
      expectIntegrity(result);
    });
  }
});

