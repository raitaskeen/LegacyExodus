import { describe, expect, it } from "bun:test";
import { IgnoreRules } from "@discovery/ignore-rules";

describe("BA-15 gitignore rules", () => {
  const rules = IgnoreRules.none.withFile("", [
    "# build output",
    "dist/",
    "/coverage",
    "*.log",
    "!keep.log",
    "**/tmp/**",
    "docs/*.html",
    "\\#hash",
    "a?c",
    "file[0-9].txt",
    "trailing   ",
  ].join("\n"), "gitignore");
  const ignored = (path: string, isDirectory = false) => rules.ignoredBy(path, isDirectory) !== undefined;

  it("matches unanchored names at any depth and directory-only patterns only on directories", () => {
    expect(ignored("dist", true)).toBe(true);
    expect(ignored("packages/a/dist", true)).toBe(true);
    expect(ignored("dist", false)).toBe(false);
    expect(ignored("x/error.log")).toBe(true);
  });

  it("anchors patterns with a leading or inner slash", () => {
    expect(ignored("coverage", true)).toBe(true);
    expect(ignored("src/coverage", true)).toBe(false);
    expect(ignored("docs/a.html")).toBe(true);
    expect(ignored("docs/sub/a.html")).toBe(false);
    expect(ignored("other/docs/a.html")).toBe(false);
  });

  it("lets a later negation re-include, and supports **, ?, classes and escapes", () => {
    expect(ignored("keep.log")).toBe(false);
    expect(ignored("a/tmp/b/c.js")).toBe(true);
    expect(ignored("a/tmp", true)).toBe(false);
    expect(ignored("#hash")).toBe(true);
    expect(ignored("abc")).toBe(true);
    expect(ignored("ac")).toBe(false);
    expect(ignored("file7.txt")).toBe(true);
    expect(ignored("filex.txt")).toBe(false);
    expect(ignored("trailing")).toBe(true);
  });

  it("applies a nested file's rules only below its directory, after the outer ones", () => {
    const nested = rules.withFile("packages/a", "generated.ts\n!dist/\n", "gitignore");
    expect(nested.ignoredBy("packages/a/src/generated.ts", false)).toBe("gitignore");
    expect(nested.ignoredBy("packages/b/generated.ts", false)).toBeUndefined();
    expect(nested.ignoredBy("packages/a/dist", true)).toBeUndefined();
    expect(nested.ignoredBy("packages/b/dist", true)).toBe("gitignore");
  });

  it("reports which ignore file decided", () => {
    const configured = rules.withFile("", "vendor/\n", "legacyexodusignore");
    expect(configured.ignoredBy("vendor", true)).toBe("legacyexodusignore");
    expect(configured.ignoredBy("dist", true)).toBe("gitignore");
  });
});
