# Subagent Rubric

Tech Lead uses this before architecture sections or **Coder breakdown**.

## Architecture sections

Always include `Data flow`.

Add `Current state` / `Target architecture` when any is true:

- Changes data movement across layers (API, table, route, service, external)
- Replaces/removes UX, endpoints, jobs, cron, or storage
- User asked for architecture comparison
- Meaningful before/after shape

Skip for: copy, UI polish, obvious local bugfix, tests-only, docs-only.

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
| 2+ | **Coder breakdown** — default **sequential** (foundations first). |

## Parallel (rare)

Set `**Parallel:** true` in the spec **only when**:

- Score ≥ 2, **and**
- File ownership is disjoint, **and**
- No merge-order dependency between parallel blocks

Otherwise keep `**Parallel:** false` and use **Execution order** mermaid for sequential work on one branch.

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

## Ownership table (required for Parallel)

```markdown
| Coder | Owns | Do not edit |
|-------|------|-------------|
| A | [`path/a.ts`](path/a.ts) | `path/b.ts` |
| B | [`path/b.ts`](path/b.ts) | `path/a.ts` |
```

## Boundaries

- Do not split just to look parallel.
- Keep tightly coupled files together.
- Keep generated files with the coder that owns generation.
- Prefer schema → contract → service → UI → cleanup.
