import * as ts from "typescript";
import { ExperimentalCompilerCache } from "./experimental-compiler-cache.ts";
import type { ReparodynamicCodingMode } from "./coding-repair-types.ts";

/**
 * Fresh compilation with tsc's type-error-preserving JSDoc parsing strategy.
 * The inherited class is only the frozen verifier's host-injection interface:
 * its text cache is not used. No SourceFile, Program, diagnostic or PASS is saved.
 * This is a type-checking host, not a documentation or language-service host.
 */
export class FreshTypecheckHost extends ExperimentalCompilerCache {
  override createHost(options: ts.CompilerOptions): ts.CompilerHost {
    const host = ts.createCompilerHost(options);
    // ParseNone / ParseForTypeInfo are deliberately NOT used: comments that
    // affect errors (and all JavaScript JSDoc) must still be parsed.
    host.jsDocParsingMode = ts.JSDocParsingMode.ParseForTypeErrors;
    return host;
  }
}

/** Leave off/shadow and the historical benchmark's default compiler untouched. */
export function codingTypecheckHost(mode: ReparodynamicCodingMode): FreshTypecheckHost | undefined {
  return mode === "canary" ? new FreshTypecheckHost() : undefined;
}
