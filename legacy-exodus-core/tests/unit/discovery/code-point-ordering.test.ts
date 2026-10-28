import { describe, expect, it } from "bun:test";
import type { Dirent } from "node:fs";

import { FileScanner } from "@discovery/file-scanner";

// NFC "ä" and NFD "a" + combining diaeresis are distinct names that ICU collation ranks as equal.
const names = ["B.js", "a.js", "_x.js", "Z.js", "ä.js", "ä.js"];
const codePointOrder = [...names].sort();

function scannerListing(order: readonly string[]): FileScanner {
  const entry = (name: string): Dirent => ({
    name,
    isSymbolicLink: () => false,
    isDirectory: () => false,
    isFile: () => true,
  }) as unknown as Dirent;
  return new FileScanner({
    readdir: (async () => order.map(entry)) as never,
    stat: (async () => ({ isDirectory: () => true, size: 1 })) as never,
  });
}

describe("BA-16 locale-independent artifact order", () => {
  it("orders discovered files by code point, not by collation", async () => {
    const result = await scannerListing(names).scan("/repo");

    expect(result.files.map((file) => file.path)).toEqual(codePointOrder);
  });

  it("gives the same order whatever order the filesystem lists entries in", async () => {
    const forward = await scannerListing(names).scan("/repo");
    const reversed = await scannerListing([...names].reverse()).scan("/repo");

    expect(reversed.files.map((file) => file.path)).toEqual(forward.files.map((file) => file.path));
  });
});
