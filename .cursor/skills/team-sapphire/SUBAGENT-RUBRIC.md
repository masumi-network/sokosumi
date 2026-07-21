# Subagent Rubric

Tech Lead uses this before architecture sections or **Coder breakdown**.

## Architecture sections

Always include `Data flow`.

Add `Current state` / `Target architecture` when any true:

- Changes data movement across layers (API, table, route, service, external)
- Replaces/removes UX, endpoints, jobs, cron, or storage
- User asked for architecture comparison
- Touches ≥2 layers with a before/after contract change

Skip for: copy-only, CSS/layout-only polish, single-file bug fix with no API/schema change, tests-only, docs-only.

## Coder scoring

| Signal | Point |
|--------|-------|
| Touches `apps/web` and `apps/core` | +1 |
| Touches `packages/database` schema, migration, or repositories | +1 |
| Touches two or more shared packages | +1 |
| Three or more distinct deliverables with non-overlapping ownership | +1 |
| Dependency chain like schema → API → client → UI | +1 |
| More than 15 files or more than four layers | +1 |

| Score | Output |
|-------|--------|
| 0–1 | **Single coder.** No breakdown. |
| 2+ | **Coder breakdown** — **sequential** on one branch (foundations first). Orchestrator opens one PR after the last coder. |

Do **not** use parallel coder branches.

## Coder block format

```markdown
### Coder A — Short scope

**Scope:** One line.

**Context:**
- Requirement / pattern to reuse / dependency

**Deliverables:**
- [`path/to/file.ts`](path/to/file.ts)

**Do not:** Boundaries.
```

Context ≤5 bullets. Deliverables = paths only.

## Boundaries

- Do not split when a single coder can own the whole Spec under score 0–1.
- Keep tightly coupled files in one coder block.
- Keep generated files with the coder that owns generation.
- Prefer schema → contract → service → UI → cleanup.
