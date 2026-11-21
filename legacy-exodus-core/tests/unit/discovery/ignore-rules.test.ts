import { describe, expect, it } from "bun:test";
import { compileGlob, globMatches, IgnoreRules } from "@discovery/ignore-rules";

/** The regular expression main built for a glob before AUD-12: the reference the new matcher must agree with. */
function referenceRegExp(glob: string, ignoreCase: boolean): RegExp {
  const escape = (char: string): string => (/[.+^${}()|[\]\\/*?]/.test(char) ? `\\${char}` : char);
  const segmentSource = (segment: string): string => {
    let source = "";
    for (let index = 0; index < segment.length; index++) {
      const char = segment[index]!;
      if (char === "\\" && index + 1 < segment.length) { source += escape(segment[++index]!); continue; }
      if (char === "*") { source += "[^/]*"; continue; }
      if (char === "?") { source += "[^/]"; continue; }
      if (char === "[") {
        const close = segment.indexOf("]", index + 2);
        if (close > index) {
          let body = segment.slice(index + 1, close);
          if (body.startsWith("!")) body = `^${body.slice(1)}`;
          source += `[${body.replace(/\\/g, "\\\\")}]`;
          index = close;
          continue;
        }
      }
      source += escape(char);
    }
    return source;
  };
  const segments = glob.split("/");
  const source = segments.map((segment, index) => {
    const last = index === segments.length - 1;
    return segment === "**" ? (last ? ".*" : "(?:[^/]+/)*") : segmentSource(segment) + (last ? "" : "/");
  }).join("");
  return new RegExp(`^${source}$`, ignoreCase ? "i" : "");
}

describe("AUD-12 gitignore matcher", () => {
  it("treats a range written backwards as holding no character instead of aborting", () => {
    const rules = IgnoreRules.none.withFile("", "x[z-a]\nkeep[a-cz-a].txt\n", "gitignore");
    expect(rules.ignoredBy("xz", false)).toBeUndefined();
    expect(rules.ignoredBy("xa", false)).toBeUndefined();
    // The rest of the class still matches, as in git.
    expect(rules.ignoredBy("keepb.txt", false)).toBe("gitignore");
    expect(rules.ignoredBy("keepz.txt", false)).toBeUndefined();
  });

  it("matches a pattern with many stars in linear time", () => {
    // On main this line took 1.0 s at 28 characters and doubled every two more (the audit's RB-09).
    const rules = IgnoreRules.none.withFile("", "*a*a*a*a*a*a*a*a*a*a*a*a*a*b\n", "gitignore");
    const started = performance.now();
    expect(rules.ignoredBy("a".repeat(200), false)).toBeUndefined();
    expect(rules.ignoredBy(`${"a".repeat(200)}b`, false)).toBe("gitignore");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("agrees with main's regular expressions on every pattern they could build", () => {
    // Deterministic generator: globs over a small alphabet of the syntax, paths over the letters they use.
    let state = 12345;
    const next = (bound: number): number => { state = (state * 1103515245 + 12345) % 2147483648; return state % bound; };
    const pieces = ["a", "b", "c", "A", "*", "?", "[ab]", "[!a]", "[a-c]", "[-a]", "[a-]", "\\*", "\\a", "-"];
    const glob = (): string => Array.from({ length: 1 + next(3) }, () => {
      if (next(6) === 0) return "**";
      return Array.from({ length: 1 + next(4) }, () => pieces[next(pieces.length)]).join("");
    }).join("/");
    const letters = ["a", "b", "c", "A", "*", "-", "ab", "ba", "abc"];
    const path = (): string => Array.from({ length: 1 + next(4) }, () =>
      Array.from({ length: 1 + next(3) }, () => letters[next(letters.length)]).join("")).join("/");
    let compared = 0;
    let matched = 0;
    for (let round = 0; round < 3000; round++) {
      const pattern = glob();
      const ignoreCase = next(2) === 0;
      const reference = referenceRegExp(pattern, ignoreCase);
      const compiled = compileGlob(pattern);
      for (let sample = 0; sample < 8; sample++) {
        const target = path();
        const expected = reference.test(target);
        expect({ pattern, target, ignoreCase, matches: globMatches(compiled, target, ignoreCase) }).toEqual({ pattern, target, ignoreCase, matches: expected });
        compared++;
        if (expected) matched++;
      }
    }
    expect(compared).toBe(24000);
    // The sample must exercise matches, not only mismatches.
    expect(matched).toBeGreaterThan(1000);
  });
});

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
