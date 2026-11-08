import { closeSync, openSync, readSync } from "node:fs";

import type { FactArray, FactStore } from "./fact-array";

const CHUNK_BYTES = 1 << 20;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

/**
 * Reads the JSON object in the file at `path`, one chunk at a time (ADR-011). A top-level member named in
 * `lists` whose value is an array becomes a `FactArray` in `store`, written item by item, so the list is never
 * in memory at once; each item passes through the list's `validate` first, whose result is what is written (and
 * which throws on an invalid item). Every other member is parsed as usual. Malformed JSON throws.
 */
export function readJsonDocument(path: string, store: FactStore, lists: ReadonlyMap<string, (item: unknown) => unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const descriptor = openSync(path, "r");
  const bytes = Buffer.allocUnsafe(CHUNK_BYTES);
  const decoder = new TextDecoder("utf-8", { fatal: true });

  let text = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  let opened = false;
  let closed = false;
  /** Start of the current member (depth 1) or list item (depth 2, in a list member), in `text`. */
  let start = 0;
  let list: { readonly key: string; readonly writer: ReturnType<FactStore["writer"]>; readonly validate: (item: unknown) => unknown; items: number } | undefined;
  let listDone = false;
  /** A member must follow: the last one ended with a comma. */
  let memberDue = false;

  const member = (raw: string): void => {
    if (listDone) {
      listDone = false;
      if (raw.trim().length > 0) throw new SyntaxError("Unexpected text after a list member.");
      return;
    }
    if (raw.trim().length === 0) throw new SyntaxError("Empty object member.");
    Object.assign(result, JSON.parse(`{${raw}}`));
  };
  const item = (raw: string, last: boolean): void => {
    if (raw.trim().length === 0) {
      if (last && list!.items === 0) return; // `[]`
      throw new SyntaxError("Empty list item.");
    }
    list!.writer.append(list!.validate(JSON.parse(raw)));
    list!.items++;
  };

  try {
    for (;;) {
      const read = readSync(descriptor, bytes, 0, CHUNK_BYTES, null);
      const offset = text.length;
      text += read === 0 ? decoder.decode() : decoder.decode(bytes.subarray(0, read), { stream: true });
      for (let index = offset; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (closed) {
          if (!isWhitespace(code)) throw new SyntaxError("Unexpected text after the document.");
          continue;
        }
        if (inString) {
          if (escaped) escaped = false;
          else if (code === BACKSLASH) escaped = true;
          else if (code === QUOTE) inString = false;
          continue;
        }
        if (code === QUOTE) {
          inString = true;
        } else if (code === OPEN_BRACE || code === OPEN_BRACKET) {
          if (depth === 0) {
            if (code !== OPEN_BRACE) throw new SyntaxError("The document is not a JSON object.");
            opened = true;
            start = index + 1;
          } else if (depth === 1 && code === OPEN_BRACKET) {
            const key = memberKey(text.slice(start, index));
            const validate = key === undefined ? undefined : lists.get(key);
            if (key !== undefined && validate !== undefined) {
              list = { key, writer: store.writer(), validate, items: 0 };
              start = index + 1;
            }
          }
          depth++;
        } else if (code === CLOSE_BRACE || code === CLOSE_BRACKET) {
          depth--;
          if (depth < 0) throw new SyntaxError("Unbalanced JSON document.");
          if (list !== undefined && depth === 1) {
            if (code !== CLOSE_BRACKET) throw new SyntaxError("Unbalanced list member.");
            item(text.slice(start, index), true);
            result[list.key] = list.writer.seal() as FactArray<unknown>;
            list = undefined;
            listDone = true;
            start = index + 1;
          } else if (depth === 0) {
            if (code !== CLOSE_BRACE) throw new SyntaxError("Unbalanced JSON document.");
            const raw = text.slice(start, index);
            if (listDone || raw.trim().length > 0) member(raw);
            else if (memberDue) throw new SyntaxError("Trailing comma in the document.");
            closed = true;
          }
        } else if (code === COMMA) {
          if (list !== undefined && depth === 2) {
            item(text.slice(start, index), false);
            start = index + 1;
          } else if (list === undefined && depth === 1) {
            member(text.slice(start, index));
            memberDue = true;
            start = index + 1;
          }
        } else if (depth === 0 && !isWhitespace(code)) {
          throw new SyntaxError("The document is not a JSON object.");
        }
      }
      // Keep only what an open member or item still needs.
      const keep = closed ? text.length : start;
      text = text.slice(keep);
      start -= keep;
      if (read === 0) break;
    }
  } catch (error) {
    list?.writer.abandon();
    throw error;
  } finally {
    closeSync(descriptor);
  }
  if (!opened || !closed || inString) throw new SyntaxError("Unterminated JSON document.");
  return result;
}

/** The key of a member's text up to its value (`"calls":`), or `undefined` when it is not a plain key. */
function memberKey(raw: string): string | undefined {
  const match = /^\s*("(?:[^"\\]|\\.)*")\s*:\s*$/s.exec(raw);
  return match === null ? undefined : JSON.parse(match[1]!) as string;
}

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09;
}
