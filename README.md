# SARA

**Self-Directed Autonomous Realization Agent**

The AI that doesn’t start over.

SARA is a repair layer around a frontier LLM (Grok). It does not make the model smarter. It makes the *system* stay intact:

1. **Test** the output against rules and the last verified-good snapshot
2. **Detect** the exact break
3. **Repair** the smallest useful unit — not the whole answer
4. **Verify** — if the patch is worse, roll it back
5. **Keep** what survived

That loop is TGRM (Targeted Gradient Repair Mechanism). RYE (repair yield per energy) is the score: how much constraint-hold you got per token (or per local patch).

## What to try

1. The sample weekend plan is already loaded, with three rules pinned: no coffee, must include a walk, keep the farmers market.
2. Hit **Repair this**. Espresso and evening coffee drop. A walk is added. The market stays. Diff, RYE, undo.
3. Toggle **TGRM off** and Repair this again — same faults, no patch. That toggle is the proof.
4. **Send** asks Grok to generate, then the same loop runs. Guests get a few generates; sign in to save verified state.

## Engine

Portable TypeScript, no model required for local repair:

```
tgrm/
  detect.ts   cheap constraint checks
  repair.ts   surgical local patch
  verify.ts   hold + retain floor (rollback if rewrite)
  loop.ts     TEST → DETECT → REPAIR → VERIFY
  rye.ts      yield / energy
```

`runTgrm({ text, constraints, tgrmEnabled })` is the whole product.

## Rules

| Kind | Meaning |
|---|---|
| `must_not` | Banned term (aliases allowed) |
| `must_include` | Required term |
| `keep_fact` | A fact that must survive the patch |

Detection is deterministic. The expensive model is used only to **generate** and, if a local patch is not enough, to **hard-repair**. Verify is cheap again.

## What SARA is not

Not AGI. Not a new foundation model. Not a tutorial on Reparodynamics. Intelligence stays in Grok. SARA adds intactness.

---

Reparodynamics · TGRM · RYE
