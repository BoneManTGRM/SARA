import * as ts from "typescript";
import { createHash } from "node:crypto";

const MAX_ENTRIES = 256;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
type Entry = { source: ts.SourceFile; bytes: number };

/**
 * Default-off, owner-side reuse of parsed external declaration files only.
 * Each lookup rereads/hashes bytes and parse context. A new Program/checker is
 * still built by the caller. No diagnostics, PASS results, candidate source,
 * emitted code, or executed child state are retained here.
 *
 * SourceFile nodes are mutable TypeScript internals. This cache is experimental:
 * use with the pinned compiler and parity tests, not across compiler versions or
 * untrusted/custom CompilerHost callbacks. Declared limits bound retained input
 * text, not total heap size; ASTs take additional memory.
 */
export class ExperimentalCompilerCache {
  readonly #entries = new Map<string, Entry>();
  #hits = 0;
  #misses = 0;
  #bypasses = 0;
  #retainedBytes = 0;

  createHost(options: ts.CompilerOptions): ts.CompilerHost {
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    const optionKey = JSON.stringify(options);
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
      // Only compiler-created parse callbacks are accepted by this owner-side
      // API. Their code plus full compiler options and package scope are keyed.
      let parseContext: string;
      try {
        parseContext = JSON.stringify(languageVersion, (_key, value: unknown) =>
          typeof value === "function" ? Function.prototype.toString.call(value) : value);
      } catch {
        this.#bypasses++;
        return original(name, languageVersion, onError, shouldCreateNewSourceFile);
      }
      const key = createHash("sha256").update(JSON.stringify([
        ts.version, name, optionKey, parseContext, text,
      ])).digest("hex");
      const found = this.#entries.get(key);
      if (found) {
        this.#hits++;
        this.#entries.delete(key);
        this.#entries.set(key, found);
        return found.source;
      }
      this.#misses++;
      // Parse the bytes just hashed, not a second disk read that could change.
      const source = ts.createSourceFile(name, text, languageVersion, false);
      while (this.#entries.size >= MAX_ENTRIES || this.#retainedBytes + bytes > MAX_TEXT_BYTES) {
        const oldest = this.#entries.keys().next().value;
        if (oldest === undefined) break;
        this.#retainedBytes -= this.#entries.get(oldest)!.bytes;
        this.#entries.delete(oldest);
      }
      this.#entries.set(key, { source, bytes });
      this.#retainedBytes += bytes;
      return source;
    };
    return host;
  }

  clear(): void {
    this.#entries.clear();
    this.#retainedBytes = 0;
  }

  snapshot() {
    return { hits: this.#hits, misses: this.#misses, bypasses: this.#bypasses,
      entries: this.#entries.size, retainedBytes: this.#retainedBytes,
      maximumEntries: MAX_ENTRIES, maximumTextBytes: MAX_TEXT_BYTES };
  }
}
