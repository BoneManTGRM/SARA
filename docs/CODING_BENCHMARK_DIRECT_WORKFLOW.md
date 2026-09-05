# GitHub direct-workflow identity compatibility

## Live issuer compatibility correction

The first live connection probe (33996630519) received 401 on readiness and
stopped before POST. A separate GitHub-only issuer diagnostic (33996944716)
showed the current provider emits job-workflow identity claims on this direct
workflow. The original authenticator rejected any presence of those claims
before fetching signing keys. No token, signature or credential was persisted.
The correction accepts only the exact same pinned pair, without relaxing any
other claim, signature, permit, owner-authentication or spending check.
Nine added regressions include the previously failing positive case, partial
and foreign pairs, malformed values, and a forged signature. The original
failed live probe remains a failure; offline fixtures are not a successful
production launch or permission to repeat paid work.

This supersedes the earlier blanket rejection of job_workflow_ref/sha. Other
workflows, forks, PRs, reruns, partial claim pairs and altered signatures remain
rejected. All budgets and the unresolved original authorization remain unchanged.
