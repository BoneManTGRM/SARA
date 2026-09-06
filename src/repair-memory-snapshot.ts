import { Buffer } from "node:buffer";

const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_RETAINED_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 4;

type Snapshot<T> = { bytes: Buffer; value: T };

/** Memoizes structural decoding, never authorization or a program's verification.
 * Callers must first reread the complete file and check its filesystem boundary.
 * The validator is fixed per instance. Exact bytes, not mtime or inode, identify a hit.
 */
export class ExactByteSnapshotCache<T> {
  readonly #decode: (text: string) => T;
  readonly #entries = new Map<string, Snapshot<T>>();
  #retainedBytes = 0;

  constructor(decode: (text: string) => T) { this.#decode = decode; }

  decode(key: string, bytes: Buffer): T {
    const cached = this.#entries.get(key);
    if (cached && cached.bytes.equals(bytes)) {
      this.#entries.delete(key); this.#entries.set(key, cached);
      return structuredClone(cached.value);
    }
    // Changed or invalid bytes must never leave a stale entry eligible.
    this.#remove(key);
    const value = this.#decode(bytes.toString("utf8"));
    if (bytes.length <= MAX_ENTRY_BYTES) {
      // Own both representations; neither input nor returned mutable values can poison reuse.
      const snapshot = { bytes: Buffer.from(bytes), value: structuredClone(value) };
      while (this.#entries.size >= MAX_ENTRIES || this.#retainedBytes + bytes.length > MAX_RETAINED_BYTES) {
        const oldest = this.#entries.keys().next().value;
        if (oldest === undefined) break;
        this.#remove(oldest);
      }
      this.#entries.set(key, snapshot); this.#retainedBytes += snapshot.bytes.length;
    }
    return value;
  }

  #remove(key: string): void {
    const entry = this.#entries.get(key);
    if (entry) { this.#entries.delete(key); this.#retainedBytes -= entry.bytes.length; }
  }
}

type BoundedReader = {
  read(buffer: Buffer, offset: number, length: number, position: null): Promise<{ bytesRead: number }>;
};

/** Read exactly the observed size plus one EOF sentinel. Partial reads are valid;
 * growth/truncation is not. Only initialized bytes are ever returned to the decoder.
 */
export async function readExactMemoryBytes(file: BoundedReader, size: number): Promise<Buffer> {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ENTRY_BYTES) throw new Error("REPAIR_MEMORY_SIZE");
  const bytes = Buffer.alloc(size + 1);
  let length = 0;
  while (length < bytes.length) {
    const result = await file.read(bytes, length, bytes.length - length, null);
    if (!Number.isSafeInteger(result.bytesRead) || result.bytesRead < 0 || result.bytesRead > bytes.length - length) {
      throw new Error("REPAIR_MEMORY_INVALID_READ");
    }
    if (result.bytesRead === 0) break;
    length += result.bytesRead;
  }
  if (length !== size) throw new Error("REPAIR_MEMORY_SIZE_CHANGED");
  return bytes.subarray(0, length);
}
