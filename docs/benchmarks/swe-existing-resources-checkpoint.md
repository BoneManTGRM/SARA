# SWE-bench continuation using existing resources

Owner constraint, 2026-09-08: use existing resources only; add no hosting expense.
No model allowance has been approved or activated by this continuation.

## Exact starting point

PR #133 head `7774bf1eb73c8be898281796eb4ac1eb8361c77b`, tree
`a015888073acf9c3ef7e64208ebb808cb1e70163`. The retained local commit
`24c19d35af7805d47fbfd111e7fc187f31d50bb3` has the identical tree.
Other work began modifying the original checkout while it was being inspected.
This diagnostic continuation uses an isolated worktree and does not overwrite
those producer, accounting, native-build, or Babel changes.

## Evidence inspected

- [CI](https://github.com/BoneManTGRM/SARA/actions/runs/34177384269)
  and [CodeQL](https://github.com/BoneManTGRM/SARA/actions/runs/34177384273)
  completed successfully on the exact PR head.
- [Real Docker proof](https://github.com/BoneManTGRM/SARA/actions/runs/34177382219)
  passed base-failure, repaired-patch, poisoned-workspace, and scripted producer
  controls for both arms. These are not Luna attempts.
- [Official controls](https://github.com/BoneManTGRM/SARA/actions/runs/34177382246)
  passed for indices 5 and 7. Retained receipts show completed base grades with
  the expected failure and completed reference grades with resolution, without
  pass-to-pass regressions. Earlier successful controls must retain their own
  source identities; they are not newly rerun controls on this head.
- [Public environments](https://github.com/BoneManTGRM/SARA/actions/runs/34177382225)
  completed with indices 5 and 7 successful and 2, 4, and 9 failed.
  Index 2 failed during native dependency installation: npm's bundled node-gyp
  used Python's removed `rU` file mode. Index 4's standalone Babel build exited
  137. Index 9's log stopped at compilation without an explanatory error.
  Its artifact SHA-256 is
  `8ef90826bd6e97f90825b7792aa800313e3549cbde7113a7f22aed69e056b159`.

The diagnostic change retains cgroup memory and process-limit counters before
and after public tests. An exec child can be killed while the container's main
sleep process survives. Counters distinguish this from a real test failure.
Diagnostics cannot grant a pass, replace official grading, change the ten tasks,
raise resource limits, or authorize spending. The follow-up selects index 9 only
to avoid duplicating the other repairs underway.

The diagnostic [Docker run 34178174489](https://github.com/BoneManTGRM/SARA/actions/runs/34178174489)
confirmed the mechanism: memory started at 455,024,640 bytes, peaked at
2,147,487,744 bytes against a 2,147,483,648-byte ceiling, and `oom_kill` rose
from 0 to 1. Process-limit events stayed at zero. Its failed artifact digest is
`cbb9b28eb81a584b671e5aa2e56287f9404b35007971b5392a016faa416a4206`.

The first memory candidate bounded Node's old-space heap to 768 MiB and lowered
Go's GC target to 25 for esbuild. Workflow `34178360150` exited successfully,
but its counters still showed an OOM kill. **That apparent pass is withdrawn.**
Its artifact digest is
`01e149e8b3708f3614b9113f96cba89201cc4dc31a6ea8dc18fc1ede57ac6d93`.

The qualification proof now rejects OOM/PID-limit events even with test exit 0,
and rejects missing or reset resource counters. Regression tests cover the real
false-pass mechanism. The integrated follow-up keeps the upstream separate
bundle setting, bounds Node old-space to 512 MiB, and sets Go's memory target to
384 MiB with GC target 25. All outer resource caps and tests remain unchanged.
This needs its own real Docker result; no pass is claimed in advance.

Parent PR #133 advanced concurrently to
`dde48bdf0660d8177f384a79cbdc3622c5bf4136`. Its public run `34178214666`
passed indices 2 and 4, while index 9 failed two assertions with single-bundle
preprocessing. This continuation incorporates the parent's native-build,
Babel and accounting repairs while retaining the original bundle isolation
for index 9. Its file inventory and process diagnostics remain recorded.

Local verification of the diagnostic candidate: after providing the unchanged
qualified native checker and an isolated TMPDIR, `npm run verify` exited 0 with
1,070 main tests, 14 HTTP tests, typecheck and every proof. The earlier completed
run passed 1,069/1,070 and failed on another concurrent run changing global
temporary-directory entries. That failure is retained. The memory-settings
candidate separately passed all six public-recipe checks; integrated and Docker
verification follow on its own revision.

## Existing-resource execution boundary

The local read-only preflight found no Docker daemon, persistent benchmark mount,
model credential, or owner authentication configuration. It created no execution
claim and made no model calls.

The existing `sara-operator` Railway service is deployed successfully with its
existing `/data` volume. Configuration lists model and owner credential names;
their presence is not credential validation. It is configured as the ordinary
SARA runtime, not as a repository Docker worker. No secrets were copied.
Railway staff have stated that nested Docker privileges are unavailable:
https://station.railway.com/feedback/docker-in-docker-d07c4730

SARA is currently a public GitHub repository. Its standard Ubuntu Actions runners
are a verified existing Docker resource, and standard runner compute for public
repositories is free:
https://docs.github.com/en/actions/reference/runners/github-hosted-runners
They remain disposable qualification runners. Artifact upload at job completion
does not supply SARA's durable dispatch reservation or live emergency-stop checks.

To run without another hosting service, either an already-owned durable Docker
host must satisfy the current contract, or an explicit worker integration must
connect the existing Actions Docker workers to SARA's existing durable Railway
authority. The latter is not implemented by this diagnostic change. It must keep
provider credentials and accounting on the existing authority, bind workers to
the exact workflow/source/task/arm, reserve dispatches before network calls,
retain uncertain exposure, and freeze every producer outcome before any grading.
The historical GitHub relay only launches its frozen historical benchmark; it
does not authorize this repository benchmark.

Do not treat a temporary runner disk or an old grant as satisfying those gates.
No hosting was provisioned, production promoted, or paid attempt started here.
The proposed $15.60 model cap remains a proposal. Freeze the final qualified
source, image identities, model settings and twenty-row plan before obtaining
the exact authenticated owner allowance.
