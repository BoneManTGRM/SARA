# Read-only recovery of the completed matched coding trial

Grant `33d94c9a-0de6-41d9-a843-fe9880994242` was actually dispatched by
GitHub run `34001820521` at 2026-09-06 00:39:34 UTC, using runtime
`2c21426a52373cb2982e9759deb7e0f81f98df63`. Railway reports both arms
incomplete after three cycles. That live source and both outcomes are fixed.
This patch is post-execution retrieval infrastructure, NOT the code tested in
that trial, a new coding task, a model rerun, or retrospective budget accounting.

The existing owner-authenticated readiness GET now exports only bounded,
allowlisted files under the selected registered benchmark directory. No caller
path or arbitrary file endpoint is added. Parent and leaf symlinks, hardlinks,
non-regular files, invalid UTF-8, oversized input and write-in-progress reads
fail closed. Raw bytes and SHA256 hashes are returned without interpreting an
incomplete claim as permission to replay. No token or environment dump is read.

Any surviving recognized receipt makes readiness unavailable and holds the
full allocation conservatively. An exit receipt indicates a terminal process,
not a successful solution. Original claims are never rewritten or deleted.
The old $0.15 hold remains unchanged. Ten new offline export regressions and
the existing HTTP owner boundary tests cover this read-only addition.

The current task, hidden acceptance tests, controllers, model worker, provider
audit, grant selector and matched CLI are unchanged. PR108's inherited result
logging is retained. Retrieval will use only GET, never another benchmark POST.
A separate earlier locally tested conservative reservation patch is preserved
as unexecuted work; it is not part of this release or the measured run.
