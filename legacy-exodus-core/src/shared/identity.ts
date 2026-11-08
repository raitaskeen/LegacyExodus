const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * The id of a fact (ADR-008 step 3): 20 base32 characters (100 bits) of the SHA-256 of its kind's domain and
 * its structural key. The key names the fact by what defines it, never by where it is, so the id survives
 * edits elsewhere in the file. Distinct domains keep facts of different kinds with equal keys apart.
 */
export function stableId(domain: string, key: string): string {
  // One-shot hashing: no hasher object per id (millions in a large repository).
  const digest = Bun.CryptoHasher.hash("sha256", `${domain}\n${key}`) as Uint8Array;
  let id = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of digest) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5 && id.length < 20) {
      id += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (id.length === 20) break;
  }
  return id;
}
