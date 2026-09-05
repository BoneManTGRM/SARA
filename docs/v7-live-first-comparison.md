# Preregistered V7 compact-first live comparison

Implementation frozen at b451a41dc7add73613c0580a9b101ddd390a93a6. No src/ code is changed. Draft and unmerged; production must remain unchanged.

User requested one live follow-up after simulations, with the existing $0.15 total physical model-spend ceiling. Compare full-file output versus compact output from the first request using the same actual controller, provider model (gpt-5.6-luna), medium reasoning, task, environment and original Genome Lab verifier. Task is a newly frozen stable bounded priority queue, not the previously used interval task. The independent oracle scans for maxima rather than copying the candidate's rank-sort approach. All 77 assertions and source manifest must pass preflight with an independent reference; defective baseline must fail. Assertions remain immutable and content-hidden from both model prompts.

This is a new contract: unlike V6, no first proposal is shared, because first-call output encoding IS the treatment. Each arm still has three cycles, two surgical files/80 changed lines, six deep files/240 changed lines and $0.15 logical ceiling. For this pair physical spending is further partitioned at $0.075 per arm, $0.15 total. At most six physical generations (three per arm) replace the old five physical generations with a shared first proposal. The extra physical initial request does not add a logical attempt, budget or authority to either arm. Every generation reserves the full bounded input/output cost before sending; unknown usage retains its reservation.

Order is preregistered compact-first then full-replacement (opposite the prior V6 pair), no concurrency, no reruns, no task replacement after observing provider output. Sequential-order effects and one-pair randomness remain limitations. First-pass wins, ties, failed/malformed replies and unknown costs are preserved. Candidate code has no repository write, production, merge or deployment authority. No owner, Telegram, NICO, payment, database or GitHub-write credentials belong in this runner. Default container command is credential-free preflight; live execution requires explicit flags and the frozen source environment pin.

Time includes initial verification, token-count round trips, generation, proposal handling, candidate checks, and a fresh final independent verification. It is not just inference latency. All source, proposal, receipt, contract and pair digests are recorded. Costs are token-rate estimates ($0.20/M input, $1.20/M output), with $0.25/M input conservative accounting for cache writes; not reconciled billing or infrastructure cost. These current Luna rates were checked against the official model documentation before this run. Cached-input discounts are not used to inflate savings.

+300% means at least 4x same-task verified speed relative to THIS new paired control, NOT the earlier 45.30-second task. Requires both independent completions and no higher cost. Completion loss or a slower/more expensive completed pair is REJECT_REGRESSION; better verified completion or faster completed work without higher cost is ACCEPT_FOR_BROADER_MATCHED_TESTING; invalid/incomplete evidence or a tie is INCONCLUSIVE. Any success remains one-case evidence; generalClaimSupported is always false. No live result has been observed when writing this preregistration.

Reproduce locally without provider use:

    npm ci --ignore-scripts
    npm run verify
    node --import tsx proof/live-v7-comparison.ts --self-test
    node --import tsx proof/live-v7-comparison.ts --self-test --all-wrong

The real-run result must be captured before credential cleanup; never retry a paid result merely to improve its outcome. Clear the provider reference and disable the command after capture without redeploying. Do not apply unrelated Railway pending changes or bypass two-factor approval.
