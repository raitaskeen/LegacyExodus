// Maps each reported taint flow back to its sink line by recomputing the engine's
// sink id formula (sha256 of `sink:<file>:<name>:<line>:<column>`) for every candidate call.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const sample = process.argv[2] ?? "s06-taint";
const file = process.argv[3] ?? "app.js";
const source = readFileSync(`C:/Projects/.audit/samples/${sample}/${file}`, "utf8").split("\n");
const graphs = JSON.parse(readFileSync(`C:/Projects/.audit/samples/${sample}.out/data-flow.json`, "utf8")).graphs;
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const ids = new Map<string, string>();
source.forEach((text, index) => {
  for (const name of ["res.send", "res.json", "child_process.exec", "response.send", "res.write", "res.redirect"]) {
    for (let column = text.indexOf(name); column >= 0; column = text.indexOf(name, column + 1)) {
      ids.set(hash(`sink:${file}:${name}:${index + 1}:${column}`), `line ${index + 1} ${name}`);
    }
  }
});
for (const graph of graphs) for (const flow of graph.taintFlows) console.log(flow.state, ids.get(flow.sinkId) ?? flow.sinkId.slice(0, 8));
