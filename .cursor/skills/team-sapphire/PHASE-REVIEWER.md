# Phase — Reviewer

Load in **Phase 4** (and standalone Reviewer / `sapphire-reviewer`). Do **not** load during Investigator / Tech Lead / Coder implement.

## Entry

Local verify exit 0 (verify set in `PHASE-CODER.md`), **CI green** (`SKILL.md`), Learnings review 0 High (`BUGBOT-LEARNINGS.md`) — else return to Phase 3.

## `/goal`

Loop until PR matches Spec (Contract / Verification / Out of scope), allowlisted verify exits 0, and UI evidence exists when **UI in scope** — or stop on unrecoverable blocker (`SKILL.md`).

**UI in scope:** Spec Verification lists ≥1 path-only route. Else skip visuals. Spawn `sapphire-reviewer` **only if user asks**.

**Fixable:** Spec mismatch or verify failure correctable without expanding Out of scope or changing Requirement. At most **one** fix→push→re-verify cycle; then blocker.

### Loop

1. Session Spec + Requirement (Linear read-only).
2. **PR trust** (below).
3. Compare Contract / Verification / Out of scope.
4. Allowlisted verify (`PHASE-CODER.md`).
5. UI in scope → `VISUAL-CAPTURE.md`. Else skip.
6. If fixable: one fix→push→re-verify. Else blocker.
7. If pushed: return `pushed: true` — orchestrator re-runs Learnings review 0 High + CI green before ready.

**`ok: true`:** `/goal` met + local verify exit 0. Does **not** skip orchestrator re-gates after a push.

## PR trust

1. Repo from `[repo=owner/name]` in Spec, else `masumi-network/sokosumi`.
2. `gh search prs --repo <owner/name> --state open "<issue-id>"`.
3. Optional: PR URL from session / user.
4. `gh pr view` — OPEN, issue id in body/title; use `headRefName`.
5. **Stop** if zero/ambiguous candidates or unvalidated foreign URL.

## Return

Structured keys only (`ok`, `prUrl`, `branch`, `verification`, `pushed`, `summary`, `blocker`). No Linear writes.
