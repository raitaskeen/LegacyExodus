import { describe, expect, it } from "bun:test";

import { ClassHierarchy, type ClassFact, type ClassHierarchyFile } from "@semantic/class-hierarchy";

const file = (filePath: string, classes: ClassFact[], extra: Partial<ClassHierarchyFile> = {}): ClassHierarchyFile =>
  ({ filePath, classes, writtenNames: [], borrowedNames: [], ...extra });
const cls = (id: string, filePath: string, members: string[], superclass?: ClassFact["superclass"], escapes = false): ClassFact =>
  ({ id, filePath, members, escapes, ...(superclass === undefined ? {} : { superclass }) });

describe("ClassHierarchy", () => {
  it("keeps a class that escapes its file open unless built closed-world (F-002)", () => {
    const files = [file("lib.js", [cls("Exported", "lib.js", ["helper"], undefined, true)])];
    expect(new ClassHierarchy(files, () => undefined).mayOverride("Exported", "helper")).toBe(true);
    expect(new ClassHierarchy(files, () => undefined, true).mayOverride("Exported", "helper")).toBe(false);
    expect(new ClassHierarchy(files, () => undefined).mayOverride("Unknown", "helper")).toBe(true);
  });

  it("keeps a class open when a class below it escapes, unless built closed-world (XA-02)", () => {
    const files = [file("lib.js", [
      cls("Base", "lib.js", ["helper"]),
      cls("Public", "lib.js", [], { kind: "class", id: "Base" }, true),
    ])];
    expect(new ClassHierarchy(files, () => undefined).mayOverride("Base", "helper")).toBe(true);
    expect(new ClassHierarchy(files, () => undefined, true).mayOverride("Base", "helper")).toBe(false);

    const deeper = [file("lib.js", [
      cls("Base", "lib.js", ["helper"]),
      cls("Mid", "lib.js", [], { kind: "class", id: "Base" }),
      cls("Public", "lib.js", [], { kind: "class", id: "Mid" }, true),
    ])];
    expect(new ClassHierarchy(deeper, () => undefined).mayOverride("Base", "helper")).toBe(true);

    const internal = [file("lib.js", [
      cls("Base", "lib.js", ["helper"]),
      cls("Inner", "lib.js", [], { kind: "class", id: "Base" }),
    ])];
    expect(new ClassHierarchy(internal, () => undefined).mayOverride("Base", "helper")).toBe(false);
  });

  it("finds overrides through local and imported subclasses, transitively", () => {
    const hierarchy = new ClassHierarchy([
      file("base.js", [cls("Base", "base.js", ["helper", "other"])]),
      file("mid.js", [cls("Mid", "mid.js", ["extra"], { kind: "import", importId: "i1", specifier: "./base" })]),
      file("leaf.js", [cls("Leaf", "leaf.js", ["helper"], { kind: "class", id: "Mid" })]),
    ], (importId) => (importId === "i1" ? "base.js" : undefined));
    expect(hierarchy.mayOverride("Base", "helper")).toBe(true);
    expect(hierarchy.mayOverride("Base", "other")).toBe(false);
    expect(hierarchy.mayOverride("Leaf", "helper")).toBe(false);
  });

  it("counts a name a subclass's file writes, but not a computed write there", () => {
    const hierarchy = new ClassHierarchy([
      file("base.js", [cls("Base", "base.js", ["helper", "run"])]),
      file("sub.js", [cls("Sub", "sub.js", [], { kind: "import", importId: "i1", specifier: "./base" })], { writtenNames: ["*", "helper"] }),
    ], () => "base.js");
    expect(hierarchy.mayOverride("Base", "helper")).toBe(true);
    expect(hierarchy.mayOverride("Base", "run")).toBe(false);
  });

  it("treats a package superclass as outside the repository and an unresolved relative one as unknown", () => {
    const external = new ClassHierarchy([
      file("a.js", [cls("A", "a.js", ["helper"])]),
      file("b.js", [cls("B", "b.js", ["helper"], { kind: "import", importId: "pkg", specifier: "events" })]),
    ], () => undefined);
    expect(external.mayOverride("A", "helper")).toBe(false);

    const unknown = new ClassHierarchy([
      file("a.js", [cls("A", "a.js", ["helper"])]),
      file("b.js", [cls("B", "b.js", ["helper"], { kind: "import", importId: "rel", specifier: "../gone" })]),
    ], () => undefined);
    expect(unknown.mayOverride("A", "helper")).toBe(true);
    expect(unknown.mayOverride("A", "run")).toBe(false);
  });

  it("lets a class with an unknown superclass, or a computed member, override any name it may define", () => {
    const hierarchy = new ClassHierarchy([
      file("a.js", [cls("A", "a.js", ["helper", "run"])]),
      file("m.js", [cls("M", "m.js", ["*"], { kind: "unknown" })]),
    ], () => undefined);
    expect(hierarchy.mayOverride("A", "run")).toBe(true);
  });

  it("reports names read as values anywhere as borrowed", () => {
    const hierarchy = new ClassHierarchy([file("x.js", [], { borrowedNames: ["lend"] })], () => undefined);
    expect(hierarchy.isBorrowed("lend")).toBe(true);
    expect(hierarchy.isBorrowed("run")).toBe(false);
  });
});
