# Fresh type-checking with less documentation parsing

This SARA-only change applies to the existing authenticated canary self-build route.
It uses TypeScript's `JSDocParsingMode.ParseForTypeErrors`, the same mode selected
by `tsc`, instead of the Compiler API's default `ParseAll`. The mode retains JSDoc
needed for type errors, including JavaScript annotations and relevant TypeScript
`@see` / `@link` comments. It is NOT `ParseNone` or `ParseForTypeInfo`.

## Boundaries

Every verification still creates a new compiler host, freshly reads/parses source,
creates a new Program/checker and executes current diagnostics. No AST is shared
across Programs and no diagnostic or PASS is cached. The existing source guard,
compiler options, transpilation, isolated behavioral process and artifact checks
are unchanged. The extra wrapper final verification and independent kernel remain.
The kernel and frozen paid benchmark still use the original default verifier.
Off/shadow routes do not opt into this host.

`FreshTypecheckCompilerHost` extends the existing compiler extension class only
to fit its nominal interface; it does not use the inherited text cache. The helper
is included in repair-memory implementation scope, so old scoped recipes are not
silently promoted across this release. No new provider call, grant, hold change,
authentication change, memory answer preload or generated-code promotion is made.

The host is for error checking, not an editor documentation/hover service. The
source guard and emitter retain their original parsing. TypeScript itself provides
the selected parsing behavior; no hand-written AST cloning or comment stripping
is introduced.

## Reproduction

Use the unchanged dependency lockfile in a credential-free checkout:

```sh
npm ci --ignore-scripts
npm run verify
node --import tsx proof/typecheck-parser-workflow.ts ../baseline ../new-results
```

The proof requires a new output directory, uses three authored programs and
prewritten one-line repairs, runs four rounds per program/arm, and alternates
execution order. Each arm must finish 12 jobs, make 3 scripted generation calls,
and run 48 fresh verifications. The fourth check is an independent post-return
diagnostic using the original verifier, not a claim of a live kernel run. Actual
HTTP/kernel wiring is tested separately, including restart reuse and four-job
concurrency. No artificial provider delays are used. Cold learning, scope hashing,
memory, required receipts and all checks are included in per-job clocks.

Component or offline workflow improvements are not a live coding multiplier,
proof of a 35x / +3,400% increase, or an advantage over equivalent ordinary compiler
configuration. Raw rows and startup samples must be retained, including regressions.

## Primary upstream references

- Microsoft, TypeScript 5.3, “Optimizations by Skipping JSDoc Parsing”:
  https://devblogs.microsoft.com/typescript/announcing-typescript-5-3/
- TypeScript v5.9.3 API `JSDocParsingMode` definitions and command-line default:
  https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/types.ts
  https://github.com/microsoft/TypeScript/blob/v5.9.3/src/executeCommandLine/executeCommandLine.ts
