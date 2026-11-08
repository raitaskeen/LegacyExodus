import { immutable } from "@shared/immutability";
/**
 * Running git inside a repository under analysis. The repository is untrusted input: its own `.git/config`
 * applies to any git command run there, and `core.fsmonitor` names a program git executes (an index read by
 * `git ls-files` runs it). Every git invocation on analyzed input uses these arguments, which disable that
 * program and keep git from taking optional locks or writing the index.
 */
export const UNTRUSTED_GIT_ARGS: readonly string[] = immutable(["--no-optional-locks", "-c", "core.fsmonitor=false"]);
