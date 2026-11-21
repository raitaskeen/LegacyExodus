/**
 * Gitignore rules (BA-15): which paths are not part of the project's authentic source. Supports the
 * gitignore syntax: comments, `\#`/`\!` escapes, trailing-space trimming, `!` negation, a trailing
 * `/` for directories only, anchoring by a leading or inner `/` (else a name matches at any depth
 * below the file's directory), `*`, `?`, `[...]` and `**`. The last matching rule wins; a path
 * under an ignored directory is never reached, as in git.
 */
export type IgnoreSource = "gitignore" | "legacyexodusignore";

interface Rule {
  /** Directory of the ignore file, project-relative POSIX ("" for the root). */
  readonly base: string;
  readonly pattern: readonly Segment[];
  /** Match regardless of case (`core.ignorecase` when the file was added). */
  readonly ignoreCase: boolean;
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  readonly source: IgnoreSource;
  /** For an ignore file above the project: the project's path from that file's directory ("" otherwise). */
  readonly prefix: string;
}

export class IgnoreRules {
  public static readonly none = new IgnoreRules([], false);

  private constructor(private readonly rules: readonly Rule[], private readonly ignoreCase: boolean) {}

  /** The same rules, with every pattern added from now on matching regardless of case (`core.ignorecase`). */
  public ignoringCase(): IgnoreRules {
    return new IgnoreRules(this.rules, true);
  }

  /**
   * These rules plus those of an ignore file in `directory`, which take precedence. `prefix` places a file
   * from above the project: its patterns see a project path as `<prefix>/<path>`.
   */
  public withFile(directory: string, text: string, source: IgnoreSource, prefix = ""): IgnoreRules {
    const added = parseIgnoreFile(directory, text, source, prefix, this.ignoreCase);
    return added.length === 0 ? this : new IgnoreRules([...this.rules, ...added], this.ignoreCase);
  }

  /**
   * The source of the rule that ignores `path`, or undefined when it is not ignored. A path under an
   * ignored directory is ignored, and no rule can re-include it (git's semantics).
   */
  public ignoredBy(path: string, isDirectory: boolean): IgnoreSource | undefined {
    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth++) {
      const ancestor = this.ownMatch(segments.slice(0, depth).join("/"), true);
      if (ancestor !== undefined) return ancestor;
    }
    return this.ownMatch(path, isDirectory);
  }

  private ownMatch(path: string, isDirectory: boolean): IgnoreSource | undefined {
    for (let index = this.rules.length - 1; index >= 0; index--) {
      const rule = this.rules[index]!;
      if (rule.directoryOnly && !isDirectory) continue;
      const seen = rule.prefix === "" ? path : `${rule.prefix}/${path}`;
      const relative = rule.base === "" ? seen : seen.startsWith(`${rule.base}/`) ? seen.slice(rule.base.length + 1) : undefined;
      if (relative === undefined || !globMatches(rule.pattern, relative, rule.ignoreCase)) continue;
      return rule.negated ? undefined : rule.source;
    }
    return undefined;
  }
}

function parseIgnoreFile(base: string, text: string, source: IgnoreSource, prefix: string, ignoreCase: boolean): Rule[] {
  const rules: Rule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.replace(/(?<!\\)\s+$/, "");
    if (line.length === 0 || line.startsWith("#")) continue;
    let negated = false;
    if (line.startsWith("!")) { negated = true; line = line.slice(1); }
    else if (line.startsWith("\\!") || line.startsWith("\\#")) line = line.slice(1);
    const directoryOnly = line.endsWith("/");
    if (directoryOnly) line = line.replace(/\/+$/, "");
    if (line.length === 0) continue;
    const anchored = line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    const glob = anchored ? line : `**/${line}`;
    rules.push({ base, pattern: compileGlob(glob), ignoreCase, negated, directoryOnly, source, prefix });
  }
  return rules;
}

/** One position in a segment pattern: a literal character, `?`, `*` or a bracket expression. */
type Token =
  | { readonly kind: "char"; readonly char: string }
  | { readonly kind: "any" }
  | { readonly kind: "star" }
  | { readonly kind: "class"; readonly negated: boolean; readonly ranges: readonly (readonly [number, number])[] };

/** A path segment pattern, or `**` (any number of whole segments). */
type Segment = { readonly kind: "globstar" } | { readonly kind: "segment"; readonly tokens: readonly Token[] };

/**
 * Compiles a glob for direct matching (AUD-12). Before, each glob became a regular expression, which could not be built
 * from some lines (`x[z-a]` aborted the analysis) and backtracked exponentially on others (`*a*a*…*a*b`). Now a segment
 * is matched in time proportional to its length times the pattern's, and `**` over whole segments the same way.
 * Exported for tests.
 */
export function compileGlob(glob: string): readonly Segment[] {
  const parts = glob.split("/");
  const segments: Segment[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (part !== "**") { segments.push({ kind: "segment", tokens: segmentTokens(part) }); continue; }
    // Leading or inner `**/` is any number of directories; a trailing `/**` is everything inside: at least one segment.
    if (index === parts.length - 1) segments.push({ kind: "segment", tokens: [{ kind: "star" }] });
    segments.push({ kind: "globstar" });
  }
  return segments;
}

function segmentTokens(segment: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < segment.length; index++) {
    const char = segment[index]!;
    if (char === "\\" && index + 1 < segment.length) { tokens.push({ kind: "char", char: segment[++index]! }); continue; }
    if (char === "*") { tokens.push({ kind: "star" }); continue; }
    if (char === "?") { tokens.push({ kind: "any" }); continue; }
    if (char === "[") {
      const close = segment.indexOf("]", index + 2);
      if (close > index) {
        tokens.push(classToken(segment.slice(index + 1, close)));
        index = close;
        continue;
      }
    }
    tokens.push({ kind: "char", char });
  }
  return tokens;
}

/**
 * A bracket expression: a leading `!` or `^` negates; `a-z` is a range; a `-` first or last is itself; a backslash is
 * itself. A range written backwards (`z-a`) holds no character, as in git; it no longer aborts the analysis.
 */
function classToken(body: string): Token {
  const negated = body.startsWith("!") || body.startsWith("^");
  const members = negated ? body.slice(1) : body;
  const ranges: [number, number][] = [];
  for (let index = 0; index < members.length; index++) {
    const low = members.charCodeAt(index);
    if (members[index + 1] === "-" && index + 2 < members.length) {
      ranges.push([low, members.charCodeAt(index + 2)]);
      index += 2;
    } else ranges.push([low, low]);
  }
  return { kind: "class", negated, ranges };
}

function inRanges(token: Extract<Token, { kind: "class" }>, char: string): boolean {
  const code = char.charCodeAt(0);
  return token.ranges.some(([low, high]) => low <= code && code <= high);
}

function tokenMatches(token: Token, char: string, ignoreCase: boolean): boolean {
  switch (token.kind) {
    case "any": return char !== "/";
    case "char": return token.char === char || (ignoreCase && token.char.toLowerCase() === char.toLowerCase());
    case "class": {
      const member = inRanges(token, char) || (ignoreCase && (inRanges(token, char.toLowerCase()) || inRanges(token, char.toUpperCase())));
      return member !== token.negated;
    }
    default: return false;
  }
}

/**
 * Wildcard matching of `units` against `pattern`, where `isStar` marks a token that takes any number of units and
 * every other token takes exactly one. On a mismatch it retries only from the last star, so the cost is at most
 * units × tokens comparisons: no exponential backtracking.
 */
function wildcard<P, U>(pattern: readonly P[], units: ArrayLike<U>, isStar: (token: P) => boolean, matches: (token: P, unit: U) => boolean): boolean {
  let token = 0;
  let unit = 0;
  let starToken = -1;
  let starUnit = 0;
  while (unit < units.length) {
    if (token < pattern.length && isStar(pattern[token]!)) { starToken = token++; starUnit = unit; continue; }
    if (token < pattern.length && matches(pattern[token]!, units[unit]!)) { token++; unit++; continue; }
    if (starToken < 0) return false;
    token = starToken + 1;
    unit = ++starUnit;
  }
  while (token < pattern.length && isStar(pattern[token]!)) token++;
  return token === pattern.length;
}

/**
 * Whether `path` matches a compiled glob. A segment is read as UTF-16 code units, as the regular expressions did.
 * Exported for tests.
 */
export function globMatches(segments: readonly Segment[], path: string, ignoreCase: boolean): boolean {
  return wildcard(segments, path.split("/"), (segment) => segment.kind === "globstar", (segment, part) =>
    segment.kind === "segment" && wildcard(segment.tokens, part, (token) => token.kind === "star", (token, char) => tokenMatches(token, char, ignoreCase)));
}
