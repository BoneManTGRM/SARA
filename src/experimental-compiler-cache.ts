import * as ts from "typescript";
import { createHash } from "node:crypto";

const MAX_ENTRIES = 256;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
type Entry = { text: string; bytes: number };

/**
 * Default-off, bounded external declaration-text deduplication.
 * Rereads and hashes each declaration on every lookup. Only immutable text is
 * retained: every request gets a freshly parsed SourceFile, and every verifier
 * still creates its own Program/checker and runs behavioral checks.
 *
 * Cross-verification AST reuse was removed: SourceFile nodes are mutable, and
 * function source text cannot identify captured parse context. The compatibility
 * class name is retained, but a text hit is NOT a skipped parse or a speed claim.
 * Limits bound retained text, not all compiler/Program heap usage.
 */
export class ExperimentalCompilerCache {
  readonly #entries = new Map<string, Entry>();
  #hits = 0;
  #misses = 0;
  #bypasses = 0;
  #retainedBytes = 0;
  #freshParses = 0;

  createHost(options: ts.CompilerOptions): ts.CompilerHost {
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
      const normalized = name.replaceAll("\\", "/");
      if (shouldCreateNewSourceFile || !normalized.includes("/node_modules/") || !normalized.endsWith(".d.ts")) {
        this.#bypasses++;
        return original(name, languageVersion, onError, shouldCreateNewSourceFile);
      }
      const text = host.readFile(name);
      if (text === undefined) {
        this.#bypasses++;
        return original(name, languageVersion, onError, shouldCreateNewSourceFile);
      }
      const bytes = Buffer.byteLength(text);
      if (bytes > MAX_TEXT_BYTES) {
        this.#bypasses++;
        return original(name, languageVersion, onError, shouldCreateNewSourceFile);
      }
      // Context need not be inferred or serialized: the exact current parse
      // options and callback are executed afresh against the bytes just hashed.
      const key = createHash("sha256").update(text).digest("hex");
      const found = this.#entries.get(key);
      if (found) {
        this.#hits++;
        this.#entries.delete(key);
        this.#entries.set(key, found);
      } else {
        this.#misses++;
        while (this.#entries.size >= MAX_ENTRIES || this.#retainedBytes + bytes > MAX_TEXT_BYTES) {
          const oldest = this.#entries.keys().next().value;
          if (oldest === undefined) break;
          this.#retainedBytes -= this.#entries.get(oldest)!.bytes;
          this.#entries.delete(oldest);
        }
        this.#entries.set(key, { text, bytes });
        this.#retainedBytes += bytes;
      }
      this.#freshParses++;
      return ts.createSourceFile(name, found?.text ?? text, languageVersion, false);
    };
    return host;
  }

  clear(): void {
    this.#entries.clear();
    this.#retainedBytes = 0;
  }

  snapshot() {
    return { reuseKind: "immutable_declaration_text" as const,
      hits: this.#hits, misses: this.#misses, bypasses: this.#bypasses, freshParses: this.#freshParses,
      entries: this.#entries.size, retainedBytes: this.#retainedBytes,
      maximumEntries: MAX_ENTRIES, maximumTextBytes: MAX_TEXT_BYTES };
  }
}
