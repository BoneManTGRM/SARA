# Recovery continuation after rollback

Follow-up to PR137, exact remote head 11d3f47770fe3b24ae8447a4cab46258edaa17a2,
local equal-tree 14f6301e1d355c37f975fb13605eb68de04604ac.
Only repository producer stopping behavior, regression tests and offline evidence
are in scope. No paid APIs, live allowance, deployment, hosting or NICO changes.

Observed gap: finish is unconditional. After a regression is rolled back to the
initial empty patch, a public-green recheck can end the producer without any
issue repair. The previous repeated-regression evaluation is now development
evidence for this follow-up. Original artifacts remain untouched.

Candidate contract: on Reparodynamic finish after a rollback to the empty initial
patch, provide at most one evidence-bound rejection of premature finish, asking
for a materially different hypothesis within remaining original limits. Permit
explicit stop after that single opportunity; never fabricate failure feedback,
claim public green proves repair, or override independent verification. Do not
intervene on an unchanged baseline without an observed rollback, nonempty repairs,
conventional operation, or exhausted/revoked authority. New state is per invocation.

New simulation freezes before candidate editing. A uses original PR135 producer;
B uses exact PR137 producer; C is the new candidate. Same deterministic substitute
and settings in all variants. The new shared substitute handles public rejection
of a finish by trying the next available public hypothesis, or stopping when none
exists; an unresponsive control ignores rejection. No variant identity, private
answers or special correct-edit branch. This model change is explicit and this
round's rates must not be mixed with the previous simulator's rates.

Frozen acceptance: >=2 extra resolved cases over B across >=2 program families,
zero B-resolved losses, zero added retained regressions, all negative controls
rejected. On equal A/B/C resolution, <=2 additional tools and tests per case and
C median runtime <=1.25*B+25ms across three counterbalanced repetitions.
All original ceilings: 50 model reservations, 200 tools, 6 public tests, 2MiB
observations, 30 minutes. No seed: response policy deterministic, timing is not.
Keep all 15 new scenario outcomes, including negative/stubborn controls. Related
stress controls and repeats are not independent task evidence. Assistant-authored
fixtures are not independent external qualification. Freeze candidate before the
new held-out run; no post-evaluation tuning. Failed gate => unaccepted experiment.

Require failing original-source behavioral checks, focused passes, typecheck and
npm run verify. Only offline qualification pin may change. Preserve old reports,
add a separate round-two report, update existing draft PR with exact source stages.
