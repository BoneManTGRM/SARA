# Bounded metadata failure feedback

Continue PR #147 from main 256aa1382b813ed6c19089a3c5ca2e6c286fd89d. Live run 34289411362 rejected two proposals containing a 438-character limitations entry. The validator correctly enforced 300 characters, but repair feedback discarded its fixed message.

Scope: feedback formatter and regression tests. Forward only exact fixed metadata-validator messages; preserve source, kernel, limits, initial prompt, model settings, request count, frozen development/acceptance cases and approval controls. No generated solution is repaired by the operator.

Minimal case: real-kernel rejection of one 438-character entry must reach the repair transport and proposal-bound durable outcome. Baseline fails with generic feedback. Fixed conditions: same rejected proposal, same request parameters, one mocked repair request; ignored repair must remain rejected with zero mutations. Critique: deterministic regression proves feedback delivery, not learning or qualification. Reordering: unchanged prompt ordering isolates feedback specificity; no ordering effect is claimed.

Acceptance: focused regression passes; exact-message allowlist rejects appended/prepended private data; captured live proposals replay unchanged and remain rejected with specific feedback; npm run verify passes. Real skill qualification still requires original development/acceptance cases and retained restart/reuse. An exhausted prior live allowance is not reused.
