# Spec Template

Tech Lead appends this as `## Spec` on the Sapphire issue. Delete sections that do not apply except **Data flow**.

````markdown
## Spec

[repo=masumi-network/sokosumi]

**Problem:** One or two sentences (may mirror Requirement).

**Goal:** One or two sentences — user-facing outcome.

**Linear:** project Sokosumi - label Feature

**Confirmed decisions:**
- Locked decision from Requirement or resolved in spec.

## Data flow

```mermaid
flowchart TB
  user[User] --> web["Web UI"]
  web --> action["Action or Service"]
  action --> data["Database or External API"]
```

## Current state

(Include when SUBAGENT-RUBRIC says so.)

## Target architecture

(Include when SUBAGENT-RUBRIC says so.)

## Contract / behavior

| Area | Spec |
|------|------|
| Input | … |
| Output | … |
| Auth | … |
| Errors | … |

## Key decisions

| Decision | Choice |
|----------|--------|
| … | … |

## Coder breakdown

(When SUBAGENT-RUBRIC score ≥ 2 — see TECH-LEAD.md.)

### Coder A — Scope name

**Scope:** One line.

**Deliverables:**
- [`path/to/file.ts`](path/to/file.ts)

**Do not:** Boundary.

## Execution order

```mermaid
flowchart LR
  A[Coder A] --> B[Coder B]
```

## Verification

Scope hints only — agents map to allowlisted `pnpm` scripts per `REVIEWER.md`.

- Scope: `apps/web` — web:check, web:test, web:build
- Manual: path-only route checks

## Out of scope

- Non-goals for v1.
````

## Before saving to Linear

- No YAML plan frontmatter.
- Remove empty optional sections.
- Keep Data flow, Verification, Out of scope.
- Preserve `## Requirement`, `## Investigation`, and `## Sapphire status` above this section.
