# Faithful learning constraints and rejection evidence

The catalog skill learning test at main afe96ee2b3cf9052184ce9b32befec86a475819f exposed a reproducible instruction defect: the pure-skill verifier rejects computed property access, while the generator never states that restriction and its repair prompt claims source/TypeScript passed even for source rejection. A diagnostic using `rows[0].sku` reproduced the contradiction without a provider call. The first live failure cause was not exported; do not attribute it to this diagnostic.

Acceptance: disclose existing pure-source restrictions to the untrusted generator; report a failed candidate without inventing passed gates; preserve bounded known verifier evidence on the existing one repair attempt; unknown errors remain generic. Never expose credentials/provider response bodies. No verifier, authority, model, budget, retry count or production promotion change.

Missing-content failures also retain allowlisted finish reasons and bounded numeric usage metadata. This is diagnostic evidence, not proof of billed cost, and never includes model reasoning or response text.

Scope: generator instruction/evidence presentation, executor feedback formatting, targeted tests. This repair is separate from the three frozen live prompt observations, which all use the old exact main source. It does not establish improved live success.

Verification: reproduce the contradiction on old source; targeted generator/feedback tests; applicable `npm run verify`; source review and draft PR only. The unrelated main CI run 34245720146 failed the 2-ms queue deadline test and must not be represented as green.
