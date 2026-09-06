# Native repair-loop checks with mandatory TypeScript 5 acceptance

The existing owner-authorized canary route can use a pinned TypeScript 7.0.2
native executable for intermediate repair-loop checks. This is not a replacement
for SARA's TypeScript 5.9.3 language contract or independent kernel verifier.

## Acceptance boundary

Every candidate still enters the unchanged bounded-source validator. Native
checking is followed by TypeScript 5 transpilation and the same permission-limited
behavioral execution. A native diagnostic falls back to the current TypeScript 5
verifier for authoritative diagnostics, rather than guessing a translation.
Abnormal native output, missing dependencies, a timeout or infrastructure failure
cannot yield PASS and does not trigger another paid model request inside this
adapter.

Before a candidate can be returned or a repair learned, the reusable generator
requires a separate fresh TypeScript 5.9.3 compilation and behavioral verification.
This also applies to a baseline that appeared correct without any repair. That
final verifier and diagnostic fallback retain the already-released
`FreshTypecheckHost`; they construct a new host, Program and checker every time.
The kernel independently runs its original default compiler and behavioral check
again and retains SHADOW staging and all promotion requirements. No compiler
syntax tree, previous diagnostic or program PASS is reused.

TypeScript 7 and 5 do not have identical semantics. The regression suite includes
a real Unicode template-literal inference example that native 7 accepts and 5.9.3
rejects. The mandatory legacy final gate prevents return and learning in that
case, with zero model calls. It fails closed rather than promising to automatically
repair every cross-version disagreement. This can reduce availability for such
inputs; this release does not claim unrestricted language-version compatibility.

## Isolation, resources and provenance

Only the fixed native executable and fixed compiler options are dispatched. No
model client, credentials or source-controlled command is passed. Inputs are
copied before asynchronous work. Source size, path and capability limits remain
those of the original validator. Each native invocation creates and removes a
private scratch workspace, uses at most two Go execution threads, and has a
five-second checker timeout and bounded output. At most two invocations and
sixteen waiters are admitted per instance; waiting is bounded to fifteen seconds.
The current constitution/emergency-stop state is checked at dispatch in the server.
An invocation holds its slot until cleanup finishes.

Native processes are trusted host tools, not a new security sandbox. Their
execution environment contains only the configured Go CPU limit; generated code
still executes in the original permission-restricted Node subprocess with its
memory/time limits. A Go CPU-thread bound is not a container-memory guarantee.
Native package files are verified against the committed manifest on startup;
protection against a compromised host modifying tools after startup is not added.

Intermediate verification evidence names the native-engine digest and requires
legacy final verification. A current final-check failure cannot be learned as a
successful repair. Original source/task/owner/failure scopes, revocation,
quarantine, budgets, cold-flight coordination and independent kernel checks remain.
The new implementation and native manifest/lockfile contribute to repair-memory
identity; prior implementation-scoped recipes invalidate rather than being
silently migrated. Existing frozen paid benchmark callers are unchanged.

## Build and activation

The root package and lockfile stay unchanged at TypeScript 5.9.3. Native 7.0.2 has
a separate exact lockfile in `tools/native-checker`; its Linux x64 executable and
package contents are checked by `integrity.json`. No native binary is committed.
On the qualified Linux x64 build host run:

```sh
node scripts/build-native-checker.mjs
npm run verify
```

The build helper runs `npm ci --ignore-scripts` only in that separate tool folder,
then verifies every manifest entry and the executable's version. Existing-service
Railway activation requires the scoped build command
`node scripts/build-native-checker.mjs`; the start command remains `npm start`.
No service, volume, budget, credential or grant needs to be recreated. The runtime
selects native checks only when the existing coding mode is canary and startup
integrity validation succeeds. Other platforms retain the existing path and are
not native-qualified; the native build/test command explicitly requires Linux x64.
Off and shadow modes do not select the native adapter. Missing or tampered native
dependencies on the qualified canary host fail startup rather than silently
claiming the native path is active.

## Reproduction and claim limits

`tests/native-coding-verifier.test.ts` checks acceptance/rejection parity for a
bounded set of ordinary fixtures, the real cross-version disagreement, failed
final verification before learning, immutable input ownership, authority and
queue cleanup. `tests/native-coding-http.test.ts` exercises actual local HTTP,
kernel verification and full restart, using scripted model responses.

`proof/native-coding-workflow.ts <new-directory> <order-offset>` runs the real local
HTTP server and kernel for three authored fixtures with cold, repeated, type-error
and unresolved episodes. Both arms use equivalent memory and adaptive output.
One arm retains released TypeScript 5 loop checks; the other selects native loop
checks. Both preserve TypeScript 5 final and independent kernel acceptance. The
protocol includes failed-job time and records boot/native integrity setup
separately. Use a fresh directory for each fixed repetition; never pool partial
runs or development candidates into final results. No provider latency is
simulated, and scripted model accounting is not actual billing. This measures
local implementation behavior, not autonomous generation speed, a unique
Reparodynamics multiplier or 35x / +3,400% performance.

No paid benchmark, consumed-grant renewal, diagnostic-answer preload, NICO action
or unattended generated-code promotion is authorized by these tools.
