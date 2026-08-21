# SARA

**Self-Directed Autonomous Realization Agent**

The AI that doesn’t start over.

SARA is a repair layer around a frontier LLM. It does not make the model smarter. It makes the *system* stay intact:

1. **Test** the output against rules and the last verified-good snapshot
2. **Detect** the exact break
3. **Repair** the smallest useful unit — not the whole answer
4. **Verify** — if the patch is worse, roll it back
5. **Keep** what survived

That loop is **TGRM** (Targeted Gradient Repair Mechanism). **RYE** (repair yield per energy) is the score: how much constraint-hold you got per token, or per local patch.

## Proof (run this)

```bash
npm install
npm test
npm run demo
```

`npm run demo` runs the same weekend-plan sample the product ships with:

| | TGRM off | TGRM on |
|---|---|---|
| Coffee / espresso | still there | gone |
| Walk | missing | added |
| Farmers market | kept | kept |
| Hold | 1/3 | 3/3 |
| Method | none | local patch |

Same text. Same rules. Off is broken. On is intact. That is the product.

## Engine

Portable TypeScript. No model required for local repair.

```
tgrm/
  detect.ts   cheap constraint checks
  repair.ts   surgical local patch
  verify.ts   hold + retain floor (rollback if rewrite)
  loop.ts     TEST → DETECT → REPAIR → VERIFY
  rye.ts      yield / energy
```

```ts
import { runTgrm, compareTgrm, SAMPLE_TEXT, SAMPLE_CONSTRAINTS } from "./tgrm/index.ts";

const { on, off } = compareTgrm({
  text: SAMPLE_TEXT,
  constraints: SAMPLE_CONSTRAINTS,
});
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

Not AGI. Not a new foundation model. Not a tutorial on Reparodynamics. Intelligence stays in the base model. SARA adds intactness.

---

Reparodynamics · TGRM · RYE
