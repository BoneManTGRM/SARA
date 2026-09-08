# Policy-sensitive stopping experiment

Confirmed PR137 f6198d5cdc8595fd889f7edbc61ad14d5bb6dd31 equals local
fa6a6d8428c24611158554a6a6c7e748862a6774. Do not change deployed systems,
NICO, live pins, allowances or services. Existing code-work skill applies.

Audit: rollback and suppression are enforced by the controller. Selection from
hypotheses and response to rejected finish came from the substitute. Fresh local
grading demonstrated toy behavioral correctness, not real-model repair discovery.
The prior stubborn control demonstrates a responsiveness limit, not absent memory.

Gap: a known failed edit can be proposed repeatedly without new information and
consume all 50 requests. Hypothesis: stop after three rejections of the same
failed tactic in the same context to reduce wasted requests. Counterexample:
a slow but capable model may need those repetitions before choosing an alternative.
This cycle tests that tradeoff rather than assuming a retry cap is beneficial.

Primary acceptance metric, fixed before implementation: >=20% lower substitute
requests than latest B on unresponsive unresolved cases in >=2 program families.
Mandatory gate: zero B-resolved losses under ANY policy; no added retained public
regressions; all designated negatives rejected; at most +2 tools/tests per case
on identical outcomes and C median <=1.25*B+25ms on those cases. Use 3 repetitions.
All original ceilings stay 50 requests/200 tools/6 tests/2MiB/30min. No seed claimed.
No-loss failure rejects the candidate even if request savings are large.

One development experiment only unless an implementation defect invalidates it;
maximum three. Freeze before untouched held-out execution; no tuning after it.
If rejected, retain executable candidate and its tests as an unaccepted experiment
and restore the production source/offline pin to exact B bytes before publication.

Shared new simulator: enumerate a public finite configuration domain (no supplied
complete solution hypotheses), with response patience 1/4/infinite for responsive,
imperfect/unresponsive. Same policy implementation/settings for every A/B/C arm.
No arm, hidden test or answer key in model. Enumeration still limits capability.
Development and evaluation are separately frozen; related policy repetitions are
not independent tasks. A is original PR135; B is exact latest PR137, C candidate.
Use real producer and fresh local grading; all substitution limitations disclosed.

Four methods: minimal loop reproduction; one changed stop mechanism; critique
request savings versus lost recoveries; inspect prompt order. The substitute uses
JSON keys rather than order, so prepare exact reordered prompt variants but do not
claim a measured model-quality effect or add order sensitivity to manufacture one.

Require focused red/green tests, full npm run verify, complete A/B/C policy table,
all logs including infrastructure failures, report and downloadable evidence.
