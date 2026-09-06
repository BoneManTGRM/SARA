# Fresh type-error-preserving compiler host

The owner-authenticated **canary** repair verifier uses a fresh TypeScript compiler host with `JSDocParsingMode.ParseForTypeErrors`. This is the type-error-preserving strategy used by the TypeScript command-line compiler: it avoids documentation-only AST work, not type errors. Unlike `ParseNone` or `ParseForTypeInfo`, it preserves required TS `@see`/`@link` comments and JavaScript JSDoc. It is not suitable for documentation extraction or language-service features needing all comments.

Every call constructs a new host and Program/checker, rereads source and dependencies, and creates fresh SourceFiles. No AST, diagnostic, type-check result or program PASS is shared. The base `ExperimentalCompilerCache` is used solely for compatibility with the unchanged verifier's typed injection interface; its text cache is not used by this subclass. Compiler options, source guards, runtime emission, isolated behavioral checks, final checks, and the independent kernel verifier remain unchanged. The kernel still uses the original default compiler host. Off/shadow routes and historical benchmark calls retain their previous host.

The new host and compatibility class source are included in repair-memory implementation identity. Previously implementation-scoped recipes are invalidated rather than promoted across this release. Owners, grants, limits, protected test bytes, model settings and SHADOW/promotion barriers are unchanged. This release invokes no provider and does not reuse a consumed paid benchmark.

## Validation and measurement

`tests/fresh-typecheck-host.test.ts` compares complete diagnostic tuples for typed TS, declarations, syntax/import errors, generic/nullability/merging cases and JavaScript JSDoc types, parameters, templates, import and satisfies annotations. It also checks fresh source/dependency reads, distinct compiler objects, current module-indicator callbacks, and full unchanged behavioral-verifier outcomes. The real local HTTP/kernel restart test asserts three distinct optimized compiler hosts per repair job; the independent kernel verification remains separately executed.

Run `node --import tsx proof/fresh-typecheck-host.ts <baseline-source-directory> <new-output-directory> controls` or use `workflow` for complete scripted repair jobs. The proof uses three authored fixtures and alternating arm order; it makes no real model calls and inserts no provider delay. The workflow includes learning, scope construction, memory I/O, mandatory receipts, three fresh repair verifications and one additional unoptimized post-return verification. That fourth check is a diagnostic, not a live kernel. Existing local HTTP/kernel tests cover the actual route independently.

These small local workloads cannot establish a dependable general coding multiplier or a 35x/+3400% improvement. An equivalent conventional compiler configuration can obtain the same mechanism. Cold setup and warm timing must remain distinguishable; do not add these ratios to previous unrelated trials.

## Primary implementation references

- https://devblogs.microsoft.com/typescript/announcing-typescript-5-3/#optimizations-by-skipping-jsdoc-parsing
- TypeScript v5.9.3 `src/compiler/types.ts`, `JSDocParsingMode.ParseForTypeErrors`.
- Locked TypeScript 5.9.3 distribution `lib/typescript.js`: `defaultJSDocParsingMode = 2 /* ParseForTypeErrors */` in the command-line implementation.
