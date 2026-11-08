import { describe, expect, test } from "bun:test";

import { DeterministicFlowAnalysisEngine } from "@flow/flow-analysis-engine";
import type { BuildContextResult, FlowState, TaintTransfer } from "@flow/data-flow-builder";
import { createDataFlowGraph, type InterproceduralFlow, type TaintFlow } from "@flow/flow-contracts";

const LINEAR_FILES = 48;
const LINEAR_TRANSFERS = LINEAR_FILES - 1;
const EVALUATION_BOUND = LINEAR_FILES * 12;

describe("DeterministicFlowAnalysisEngine repository-wide propagation scaling", () => {
  test("observes transfer evaluation independently of traversal syntax", () => {
    const observed = observeTransferEvaluations([
      transfer("definition:1", "definition:0"),
      transfer("definition:2", "definition:1"),
    ]);

    observed.transfers.filter((candidate) => candidate.sourceDefinitionId.length > 0);
    for (const candidate of observed.transfers) {
      void candidate.sourceDefinitionId;
    }

    expect(observed.evaluations()).toBe(4);
  });

  test("bounds transfer evaluation for a reverse-ordered linear inter-file chain", () => {
    const fixture = createLinearFixture(LINEAR_FILES);
    const result = new DeterministicFlowAnalysisEngine().connect([], fixture.contexts);
    const flows = allTaintFlows(result.dataFlowGraphs);
    const expectedPath = [
      fixture.sourceId,
      ...Array.from({ length: LINEAR_FILES }, (_, offset) => definitionId(LINEAR_FILES - 1 - offset)),
      fixture.sinkName,
    ];

    expect(fixture.transferCount).toBe(LINEAR_TRANSFERS);
    expect(fixture.interproceduralFlowCount).toBe(LINEAR_TRANSFERS);
    expect(flows).toEqual([
      {
        sourceId: fixture.sourceId,
        sinkId: fixture.sinkId,
        path: expectedPath,
        state: "CONFIRMED",
      },
    ]);
    // Covers one canonical O(T) setup plus affected-work propagation while
    // decisively rejecting the baseline's repeated whole-transfer rescans.
    expect(fixture.evaluations()).toBeLessThanOrEqual(EVALUATION_BOUND);
  });

  test("preserves deterministic fan-out and sink propagation", () => {
    const sourceId = "source:fan-out";
    const fixture = createSingleGraphFixture({
      transfers: [
        transfer("definition:root", "definition:left"),
        transfer("definition:root", "definition:right"),
      ],
      seeds: [seed("definition:root", sourceId, [sourceId, "definition:root"])],
      sinks: [
        sink("sink:left", "sink.left", "definition:left"),
        sink("sink:right", "sink.right", "definition:right"),
      ],
    });

    expect(allTaintFlows(new DeterministicFlowAnalysisEngine().connect([], fixture).dataFlowGraphs)).toEqual([
      {
        sourceId,
        sinkId: "sink:left",
        path: [sourceId, "definition:root", "definition:left", "sink.left"],
        state: "CONFIRMED",
      },
      {
        sourceId,
        sinkId: "sink:right",
        path: [sourceId, "definition:root", "definition:right", "sink.right"],
        state: "CONFIRMED",
      },
    ]);
  });

  test("re-evaluates downstream work after a shorter canonical path replaces an earlier path", () => {
    const sourceId = "source:replacement";
    const fixture = createSingleGraphFixture({
      transfers: [
        transfer("definition:a", "definition:out"),
        transfer("definition:b", "definition:a"),
      ],
      seeds: [
        seed("definition:a", sourceId, [sourceId, "definition:z1", "definition:z2", "definition:z3", "definition:a"]),
        seed("definition:b", sourceId, [sourceId, "definition:a0", "definition:b"]),
      ],
      sinks: [sink("sink:replacement", "sink.replacement", "definition:out")],
    });

    expect(allTaintFlows(new DeterministicFlowAnalysisEngine().connect([], fixture).dataFlowGraphs)).toEqual([
      {
        sourceId,
        sinkId: "sink:replacement",
        path: [sourceId, "definition:a0", "definition:b", "definition:a", "definition:out", "sink.replacement"],
        state: "CONFIRMED",
      },
    ]);
  });

  test("preserves canonical first-path selection for equal-length merges", () => {
    const sourceId = "source:equal";
    const fixture = createSingleGraphFixture({
      transfers: [
        transfer("definition:a", "definition:target"),
        transfer("definition:b", "definition:target"),
        transfer("definition:z", "definition:a"),
        transfer("definition:z", "definition:b"),
      ],
      seeds: [seed("definition:z", sourceId, [sourceId, "definition:z"])],
      sinks: [sink("sink:equal", "sink.equal", "definition:target")],
    });

    expect(allTaintFlows(new DeterministicFlowAnalysisEngine().connect([], fixture).dataFlowGraphs)).toEqual([
      {
        sourceId,
        sinkId: "sink:equal",
        path: [sourceId, "definition:z", "definition:a", "definition:target", "sink.equal"],
        state: "CONFIRMED",
      },
    ]);
  });

  test("terminates cycles and produces byte-identical output and counts across repeated runs", () => {
    const snapshots = Array.from({ length: 3 }, () => {
      const sourceId = "source:cycle";
      const observed = observeTransferEvaluations([
        transfer("definition:a", "definition:b"),
        transfer("definition:b", "definition:c"),
        transfer("definition:c", "definition:a"),
        transfer("definition:z", "definition:a"),
      ]);
      const fixture = createSingleGraphFixture({
        transfers: observed.transfers,
        seeds: [seed("definition:z", sourceId, [sourceId, "definition:z"])],
        sinks: [sink("sink:cycle", "sink.cycle", "definition:c")],
      });
      const result = new DeterministicFlowAnalysisEngine().connect([], fixture);
      return {
        normalized: JSON.stringify(result.dataFlowGraphs),
        evaluations: observed.evaluations(),
        flows: allTaintFlows(result.dataFlowGraphs),
      };
    });

    expect(snapshots[0]?.flows).toEqual([
      {
        sourceId: "source:cycle",
        sinkId: "sink:cycle",
        path: [
          "source:cycle",
          "definition:z",
          "definition:a",
          "definition:b",
          "definition:c",
          "sink.cycle",
        ],
        state: "CONFIRMED",
      },
    ]);
    expect(snapshots[1]).toEqual(snapshots[0]);
    expect(snapshots[2]).toEqual(snapshots[0]);
  });
});

interface FixtureSeed {
  readonly definitionId: string;
  readonly sourceId: string;
  readonly path: readonly string[];
}

interface FixtureSink {
  readonly id: string;
  readonly name: string;
  readonly definitionId: string;
}

function createLinearFixture(fileCount: number): {
  readonly contexts: readonly BuildContextResult[];
  readonly evaluations: () => number;
  readonly transferCount: number;
  readonly interproceduralFlowCount: number;
  readonly sourceId: string;
  readonly sinkId: string;
  readonly sinkName: string;
} {
  const sourceId = "source:linear";
  const sinkId = "sink:linear";
  const sinkName = "sink.linear";
  const rawTransfers = Array.from({ length: fileCount - 1 }, (_, offset) =>
    transfer(definitionId(offset + 1), definitionId(offset)),
  );
  const observed = observeTransferEvaluations(rawTransfers);
  const contexts = Array.from({ length: fileCount }, (_, index) => {
    const currentTransfer = index === 0 ? undefined : observed.transfers[index - 1];
    return createContext(`src/linear-${index.toString().padStart(3, "0")}.js`, {
      transfers: currentTransfer === undefined ? [] : [currentTransfer],
      seeds: index === fileCount - 1
        ? [seed(definitionId(index), sourceId, [sourceId, definitionId(index)])]
        : [],
      sinks: index === 0 ? [sink(sinkId, sinkName, definitionId(0))] : [],
    });
  });

  return {
    contexts,
    evaluations: observed.evaluations,
    transferCount: rawTransfers.length,
    interproceduralFlowCount: contexts.reduce((count, context) => count + context.graph.interproceduralFlows.length, 0),
    sourceId,
    sinkId,
    sinkName,
  };
}

function createSingleGraphFixture(input: {
  readonly transfers: readonly TaintTransfer[];
  readonly seeds: readonly FixtureSeed[];
  readonly sinks: readonly FixtureSink[];
}): readonly BuildContextResult[] {
  return [createContext("src/fixture.js", input)];
}

function createContext(
  filePath: string,
  input: {
    readonly transfers: readonly TaintTransfer[];
    readonly seeds: readonly FixtureSeed[];
    readonly sinks: readonly FixtureSink[];
  },
): BuildContextResult {
  const interproceduralFlows = input.transfers.map((candidate, index): InterproceduralFlow => ({
    id: `flow:${filePath}:${index}`,
    callId: `call:${filePath}:${index}`,
    kind: "argument-to-parameter",
    sourceDefinitionId: candidate.sourceDefinitionId,
    targetDefinitionId: candidate.targetDefinitionId,
  }));
  const state: FlowState = {
    definitions: [],
    uses: [],
    taintPaths: new Map(input.seeds.map((candidate) => [
      candidate.definitionId,
      new Map([[candidate.sourceId, Object.freeze([...candidate.path])]]),
    ])),
    transfers: [...input.transfers],
    sinks: input.sinks.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      argumentDefinitionIds: [candidate.definitionId],
    })),
    functions: new Map(),
    resolvableFunctions: new Map(),
    functionsBySymbolId: new Map(),
    provenTargets: new Map(),
    hasSemanticResolution: false,
    pendingCalls: [],
    interproceduralFlows: [],
    joins: new Map(),
  };
  const graph = createDataFlowGraph({
    id: `dfg:${filePath}`,
    filePath,
    state: "INFERRED",
    definitions: [],
    uses: [],
    defUseChains: [],
    lifetimes: [],
    taintFlows: [],
    interproceduralFlows,
    functionSummaries: [],
    callBindings: [],
  });
  return { graph, state: { ...state, localDefinitionIds: new Set() } };
}

function observeTransferEvaluations(source: readonly TaintTransfer[]): {
  readonly transfers: readonly TaintTransfer[];
  readonly evaluations: () => number;
} {
  let evaluations = 0;
  const transfers = source.map((candidate) => new Proxy(candidate, {
    get(target, property, receiver) {
      if (property === "sourceDefinitionId") evaluations += 1;
      return Reflect.get(target, property, receiver);
    },
  }));
  return { transfers, evaluations: () => evaluations };
}

function allTaintFlows(graphs: readonly { readonly taintFlows: readonly TaintFlow[] }[]): readonly TaintFlow[] {
  return graphs.flatMap((graph) => graph.taintFlows);
}

function transfer(sourceDefinitionId: string, targetDefinitionId: string): TaintTransfer {
  return { sourceDefinitionId, targetDefinitionId };
}

function seed(definitionIdValue: string, sourceId: string, path: readonly string[]): FixtureSeed {
  return { definitionId: definitionIdValue, sourceId, path };
}

function sink(id: string, name: string, definitionIdValue: string): FixtureSink {
  return { id, name, definitionId: definitionIdValue };
}

function definitionId(index: number): string {
  return `definition:${index.toString().padStart(3, "0")}`;
}
