# Strict memory decoding, read-only projection, and one new live comparison

Owner request: improve and harden, then run the real new maximum comparison using
SARA. Base release is 478ed987bcf3d6959fd2cd2294f97596d94e4b5a.

The memory snapshot decoder now rejects malformed UTF-8 before JSON parsing.
Replacement decoding previously let corrupt bytes be interpreted as legitimate
U+FFFD characters, even when decoded record digests agreed. No production incident
or arbitrary remote code execution is claimed. Valid Unicode is unchanged.

Read-only lookups and final identity checks now project their result from an owned,
deep-frozen, structurally validated plain-data snapshot. Only that selected result
is cloned, rather than cloning the whole 128-record store. Every transaction still
locks, checks filesystem boundaries, rereads exact current bytes and synchronizes
lock release. Writes use separate mutable copies; every genuine change retains the
original fsync/rename sequence. Unsupported internal-mutable types are rejected.
Changed or invalid bytes invalidate old snapshots. No compiler result, acceptance
PASS, source-policy decision, or authority is cached.

The new grant d89f2a9c-3e8e-4e91-a41d-3f0836c1b3ea is separate from all historical
holds and consumed runs. Its cap is $0.15 total / $0.05 per arm. The unchanged
three-arm, four-round reuse runner is used with fresh isolated benchmark memory.
Each memory arm must learn its own real-model repair during the new run. Every
job receives all fresh checks including the mandatory legacy final and independent
acceptance. The new CLI pins all changed runtime modules before paid execution.

Report best observed repeat, all warm repeats, and learning-inclusive aggregates,
including the ordinary-memory control and every failure. This is the same small
previously used task, not general new-task coding, a full kernel job lifecycle,
a causal old/new version performance estimate, or an absolute maximum. Do not
multiply previous ratios or hide slower outcomes. The new run must use a current
exact-source OIDC permit and unused readiness before at most one POST. After any
POST uncertainty, recovery is GET-only. Keep old results, holds and grants intact.

Require full local verify, exact-head CI and CodeQL, then deploy exact merged
source on the existing operator. No NICO, new infrastructure, credential disclosure,
unbounded spend, global budget change, or generated-code promotion.
