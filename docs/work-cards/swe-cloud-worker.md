# Existing-cloud repository benchmark

Owner constraint: existing cloud services only; no available computer, added
hosting expense, paid runner, new service, volume, or credential in CI.

The candidate keeps the existing Railway kernel, owner authentication, durable
whole-run claim, dispatch journal, Luna adapter and finite budget as the only
authority. Standard GitHub-hosted jobs execute the existing isolated repository
sessions and official judge. This work card grants no spending or promotion.

Acceptance criteria:

1. A disabled-by-default worker transport authenticates GitHub OIDC to an exact
   repository, source, workflow, first workflow attempt and active owner-approved
   registration. Workers cannot authenticate as owner or call the model API.
2. The coordinator durably records each bounded command and response, binds them
   to one worker and attempt, and rejects replay with different content. Lost or
   uncertain execution closes the run; it never restarts generation.
3. Producers and fresh public verification use the unchanged Docker sandbox.
   Grading runs in separate jobs after the durable twenty-outcome freeze. Neither
   hidden tests nor reference patches enter producer jobs.
4. Separate bounded jobs preserve the proposed thirty-minute per-attempt limit
   within GitHub's six-hour job maximum. Both arms pull the exact same qualified
   public image digest. No new paid hosting or larger runner is configured.
5. Focused adversarial tests and a real Docker transport proof cover authentication,
   response substitution/replay, stop and disconnect, fresh verification and
   independent grading. Scripted fixtures remain explicitly non-benchmark proof.
6. Publish the reviewable candidate with validation evidence. Before real model
   dispatch, freeze all ten qualified images, source/settings/prices/caps, and
   require the existing authenticated owner approval of that exact fresh grant.

Use the existing server and ledger. Do not add another backend or move model or
owner credentials to Actions. Production promotion and protected authority
configuration remain owner actions under AGENTS.md and the Constitution.
