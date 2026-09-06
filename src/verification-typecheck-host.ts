import * as ts from "typescript";
import { ExperimentalCompilerCache } from "./experimental-compiler-cache.ts";
import { verifyGenomeLabProgramCandidate } from "./genome-lab-verifier.ts";

/**
 * A fresh host using the JSDoc mode used by tsc: retain everything needed for
 * type errors, without building documentation-only ASTs. Not ParseNone or
 * ParseForTypeInfo. No SourceFile, Program, checker, diagnostics or PASS cache.
 *
 * The superclass only satisfies the existing verifier's nominal extension
 * interface. Its declaration-text cache is unused and the frozen verifier and
 * independent kernel remain unchanged.
 */
export class FreshTypecheckCompilerHost extends ExperimentalCompilerCache {
  override createHost(options: ts.CompilerOptions): ts.CompilerHost {
    const host = ts.createCompilerHost(options);
    host.jsDocParsingMode = ts.JSDocParsingMode.ParseForTypeErrors;
    return host;
  }
}

type VerificationInput = Omit<Parameters<typeof verifyGenomeLabProgramCandidate>[0], "experimentalCompilerCache">;

/** Canary self-build only. Historical benchmark and kernel keep their original verifier. */
export function verifyCanaryProgramCandidate(input: VerificationInput) {
  return verifyGenomeLabProgramCandidate({ ...input, experimentalCompilerCache: new FreshTypecheckCompilerHost() });
}
