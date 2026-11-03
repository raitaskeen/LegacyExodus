/**
 * Synthetic scale corpus (ADR-009 step 5): `files` small modules, the same bytes for the same count, so peak
 * memory can be gated at a size no real corpus in CI reaches. Each module imports its two predecessors,
 * exports a function and a class, calls across files, and every 50th one routes a request field into a query.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PER_DIRECTORY = 100;

function directory(index: number): string {
  return `src/d${String(Math.floor(index / PER_DIRECTORY)).padStart(4, "0")}`;
}

function modulePath(index: number): string {
  return `${directory(index)}/m${index}.js`;
}

function relative(from: number, to: number): string {
  return directory(from) === directory(to) ? `./m${to}.js` : `../${directory(to).slice(4)}/m${to}.js`;
}

function source(index: number): string {
  const imports = [index - 1, index - 2].filter((other) => other >= 0);
  const lines = imports.map((other) => `import { step${other}, Box${other} } from "${relative(index, other)}";`);
  lines.push(
    "",
    `export function step${index}(value, options = {}) {`,
    `  const scaled = value * ${(index % 7) + 2};`,
    "  if (options.verbose && scaled > 10) {",
    `    console.log("step ${index}", scaled);`,
    "  }",
    ...imports.map((other) => `  const from${other} = step${other}(scaled);`),
    `  return ${imports.length === 0 ? "scaled" : imports.map((other) => `from${other}`).join(" + ")};`,
    "}",
    "",
    `export class Box${index} {`,
    "  constructor(items) { this.items = items ?? []; }",
    `  total() { return this.items.reduce((sum, item) => sum + step${index}(item), 0); }`,
    "}",
  );
  if (index % 50 === 0) {
    lines.push(
      "",
      `export function route${index}(app, db) {`,
      `  app.get("/items/${index}", (req, res) => {`,
      "    const name = req.query.name;",
      "    res.send(db.query(`SELECT * FROM items WHERE name = '${name}'`));",
      "  });",
      "}",
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Writes the corpus once; an existing complete corpus of this size is reused. */
export async function ensureSyntheticCorpus(root: string, files: number): Promise<string> {
  const target = join(root, `synthetic-${files}`);
  const marker = join(target, ".complete");
  if (existsSync(marker)) return target;
  for (let index = 0; index < files; index++) {
    if (index % PER_DIRECTORY === 0) await mkdir(join(target, directory(index)), { recursive: true });
    await writeFile(join(target, modulePath(index)), source(index));
  }
  await writeFile(join(target, "package.json"), `${JSON.stringify({ name: `synthetic-${files}`, version: "1.0.0", type: "module" }, null, 2)}\n`);
  await writeFile(marker, "");
  return target;
}
