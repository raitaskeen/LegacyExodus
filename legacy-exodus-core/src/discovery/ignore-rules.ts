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
  readonly pattern: RegExp;
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  readonly source: IgnoreSource;
}

export class IgnoreRules {
  public static readonly none = new IgnoreRules([]);

  private constructor(private readonly rules: readonly Rule[]) {}

  /** These rules plus those of an ignore file in `directory`, which take precedence. */
  public withFile(directory: string, text: string, source: IgnoreSource): IgnoreRules {
    const added = parseIgnoreFile(directory, text, source);
    return added.length === 0 ? this : new IgnoreRules([...this.rules, ...added]);
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
      const relative = rule.base === "" ? path : path.startsWith(`${rule.base}/`) ? path.slice(rule.base.length + 1) : undefined;
      if (relative === undefined || !rule.pattern.test(relative)) continue;
      return rule.negated ? undefined : rule.source;
    }
    return undefined;
  }
}

function parseIgnoreFile(base: string, text: string, source: IgnoreSource): Rule[] {
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
    rules.push({ base, pattern: new RegExp(`^${globToSource(glob)}$`), negated, directoryOnly, source });
  }
  return rules;
}

function globToSource(glob: string): string {
  const segments = glob.split("/");
  let source = "";
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const last = index === segments.length - 1;
    if (segment === "**") {
      // Leading or inner `**/` is any number of directories; a trailing `/**` is everything inside.
      source += last ? ".*" : "(?:[^/]+/)*";
      continue;
    }
    source += segmentToSource(segment) + (last ? "" : "/");
  }
  return source;
}

function segmentToSource(segment: string): string {
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
}

function escape(char: string): string {
  return /[.+^${}()|[\]\\/*?]/.test(char) ? `\\${char}` : char;
}
