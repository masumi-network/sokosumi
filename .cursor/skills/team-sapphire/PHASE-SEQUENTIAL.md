# Phase — Sequential (orchestrator)

Load **only** when Spec **Coders:** ≥ 2 (rubric ≥ 2). Do **not** give this file to `sapphire-coder`.

## Light Spec-compliance check

After each sequential block returns `ok: true` and `pushed: true`, **before** the next Coder Task. Orchestrator only — **not** Phase 4.

**Inputs:** session Spec Coder block (Deliverables + Do not) +:

```bash
git diff origin/main...HEAD -- <each Deliverable path from this block>
```

Use Deliverable paths exactly as written in the Spec (files or directories).

**Check only:**

1. Every Deliverable path in the block exists on the branch (or intentional delete listed in Spec).
2. Contract rows that the block owns are implemented (behavior present in diff or referenced code).
3. Block did not implement items listed in Out of scope or that block’s **Do not**.

**Do not check:** general defects, domain patterns (`QUALITY-TRIGGERS.md`), UI screenshots, full-repo verify, other blocks’ Deliverables.

**Return (session, structured):**

```text
ok: true|false
block: <Coder A|B|…>
mismatch: none|high|medium
summary: <one line>
blocker: <text if ok false>
```

| Result | Action |
|--------|--------|
| `mismatch: none` | `ok: true` → next sequential Task (or open draft PR if last) |
| `mismatch: high` | Missing Deliverable, owned Contract absent, or Out of scope / Do not violated → **one** fix Task for that block, re-check once; second high → unrecoverable blocker |
| `mismatch: medium` | Non-Contract nit (naming, comment) → note in session, `ok: true`, continue |
| Unclear high vs medium | `mismatch: high` (do not guess toward pass) |

After last sequential `ok`: open **one** draft PR (`PHASE-CODER.md` title/body), **CI green**, Phase 4.
