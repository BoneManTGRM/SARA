# Preserve runtime mismatch evidence

PR #142 merged as 69b660bdaf715e5e91be74e3758e67edc2c0d3e9. Free qualification run 34264000999 consumed its two requests: a parsed proposal failed behavioral verification, then the repair returned no content at the 8192-token ceiling. No further live request is authorized in this cycle.

Confirmed defect: boundedCandidateFailureFeedback matches the first occurrence of the mismatch marker in a child-process error. Node prints the verifier's source line before the actual Error line, so the repair received the literal `${JSON.stringify(failures)}` expression instead of observed differences. The archived proposal also contains an incorrect expected result; do not repair generated code or producer tests and call that learning.

Change one mechanism: extract a line-start runtime mismatch array, accepting Node's Error prefix, while retaining the existing feedback length bound and fallback. Keep model, verifier, source restrictions, retry count, budgets and authority unchanged.

Acceptance: a real isolated verification failure must yield exact expected/actual observations through the feedback function; source excerpts alone must fall back without asserting a gate passed. Existing focused feedback tests and npm run verify must pass. Falsification: the literal source expression remains, actual mismatches disappear, or verification/limits change. Run the captured proposal unchanged locally for diagnosis only; keep catalog acceptance unrun because no eligible candidate was produced. No claim that corrected evidence will cause model recovery.

Four methods: minimal real-verifier reproduction; one extraction variable under fixed conditions; critique distinguishes incorrect producer expectations from implementation defects and feedback loss; prompt ordering is unchanged and its live comparison remains unrun because the allowance is exhausted.
