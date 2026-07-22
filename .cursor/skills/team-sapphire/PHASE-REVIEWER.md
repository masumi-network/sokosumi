# Phase — Reviewer

Load in **Phase 4** (and standalone Reviewer / `sapphire-reviewer`). Do **not** load during Investigator / Tech Lead / Coder implement.

**Owner of `/goal` order and severity — do not restate in ROLES/SKILL.**

## Entry

Local verify exit 0 (verify set in `PHASE-CODER.md`), **CI green** (`SKILL.md`) — else return to Phase 3.

## `/goal` (full review)

Loop until all hold — or unrecoverable blocker (`SKILL.md`):

1. Spec match (Contract / Verification / Out of scope)
2. Allowlisted verify exit 0 (fresh this turn)
3. No unresolved **High** from general review
4. No unresolved **High** from triggered domain patterns
5. UI evidence when **UI in scope**

One full review — not Bugbot / R-only. Follow **Loop** exactly.

**UI in scope:** Spec Verification lists ≥1 path-only route. Else skip visuals. Spawn `sapphire-reviewer` **only if user asks**.

**Fixable High:** Spec mismatch, general High, domain-pattern High, or verify failure — without expanding Out of scope or changing Requirement. At most **one** fix→push→re-verify; then blocker.

**Medium:** PR body notes (below); do not block ready unless user asks to fix.

### Loop

1. Session Spec + Requirement (Linear read-only).
2. **PR trust** (below).
3. **Spec compliance** — Contract / Verification / Out of scope.
4. Allowlisted verify (`PHASE-CODER.md`) — fresh this turn.
5. **General review** on `git diff` merge-base…HEAD — severity table below.
6. `QUALITY-TRIGGERS.md` vs diff → load **matching** `QUALITY-RULES.md` sections only → check those patterns.
7. UI in scope → `VISUAL-CAPTURE.md`. Else skip.
8. Fixable High → one fix→push→re-verify. Else High remains → blocker. Medium only → PR notes → ready.
9. If pushed: `pushed: true` — orchestrator re-checks **CI green** before ready.

**`ok: true`:** `/goal` met + verify exit 0 + zero unresolved High.

### Severity (any finding — Spec, general, R)

If High vs Medium unclear → **High**.

| Severity | Must use when | Action |
|----------|---------------|--------|
| **High** | Behavior contradicts Spec Contract; authz/workspace/capability hole; data loss or billing/money drift; `apps/web` imports Prisma/`@sokosumi/database` repositories; verify set fails; TDD required (`PHASE-CODER.md`) but no test covers Contract | Must fix (one cycle) |
| **Medium** | Happy-path Spec holds, but error path incomplete; dead code in touched files; misleading name; weak but green test | PR body only |
| **Low** | Style / comment / import-order already covered by check | Optional note |

Axes (general review): bugs vs Spec; security/authz; error handling; wrong layer / dead code / names; tests when TDD required or Spec lists proving test command.

### Medium findings — PR body only

```markdown
### Review notes — medium (human review)

| Area | Location | Finding |
|------|----------|---------|
| Spec / defect / R# | `path:line` | … |
```

Skip when no medium findings. Do **not** post to Linear.

## PR trust

1. Repo from `[repo=owner/name]` in Spec, else `masumi-network/sokosumi`.
2. `gh search prs --repo <owner/name> --state open "<issue-id>"`.
3. Optional: PR URL from session / user.
4. `gh pr view` — OPEN, issue id in body/title; use `headRefName`.
5. **Stop** if zero/ambiguous candidates or unvalidated foreign URL.

## Return

Structured keys only (`ok`, `prUrl`, `branch`, `verification`, `pushed`, `summary`, `blocker`). No Linear writes.
