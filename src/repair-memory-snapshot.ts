import { Buffer, isUtf8 } from "node:buffer";

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
    return this.project(key, bytes, value => value);
  }

  /** Synchronous read-only projection. Only the selected result is copied; the
   * cached plain-data graph is deeply frozen, never shared as mutable authority.
   * Callers still reread/validate current file bytes under their existing lock.
   */
  project<R>(key: string, bytes: Buffer, select: (value: T) => R): R {
    const cached = this.#entries.get(key);
    if (cached && cached.bytes.equals(bytes)) {
      this.#entries.delete(key); this.#entries.set(key, cached);
      return structuredClone(select(cached.value));
    }
    this.#remove(key);
    // Buffer.toString replaces malformed sequences. Reject them before parsing
    // so corrupt bytes cannot be accepted as legitimate replacement characters.
    if (!isUtf8(bytes)) throw new Error("REPAIR_MEMORY_INVALID_UTF8");
    const value = freezePlainData(structuredClone(this.#decode(bytes.toString("utf8"))));
    if (bytes.length <= MAX_ENTRY_BYTES) {
      const snapshot = { bytes: Buffer.from(bytes), value };
      while (this.#entries.size >= MAX_ENTRIES || this.#retainedBytes + bytes.length > MAX_RETAINED_BYTES) {
        const oldest = this.#entries.keys().next().value;
        if (oldest === undefined) break;
        this.#remove(oldest);
      }
      this.#entries.set(key, snapshot); this.#retainedBytes += snapshot.bytes.length;
    }
    return structuredClone(select(value));
  }

  #remove(key: string): void {
    const entry = this.#entries.get(key);
    if (entry) { this.#entries.delete(key); this.#retainedBytes -= entry.bytes.length; }
  }
}

/** Object.freeze does not immobilize Map/Date/typed-array internal state.
 * This cache is for structurally validated plain records, arrays and primitives.
 */
function freezePlainData<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error("REPAIR_MEMORY_SNAPSHOT_NOT_PLAIN_DATA");
  }
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezePlainData(child, seen);
  return Object.freeze(value);
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
