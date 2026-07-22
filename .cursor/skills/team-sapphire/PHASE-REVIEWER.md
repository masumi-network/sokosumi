# Phase — Reviewer

Load in **Phase 4** (and standalone Reviewer / `sapphire-reviewer`). Do **not** load during Investigator / Tech Lead / Coder implement.

## Entry

Local verify exit 0 (verify set in `PHASE-CODER.md`), **CI green** (`SKILL.md`) — else return to Phase 3.

## `/goal` (full review)

Loop until PR matches Spec (Contract / Verification / Out of scope), allowlisted verify exits 0, triggered `QUALITY-RULES.md` R1–R12 hold, and UI evidence exists when **UI in scope** — or stop on unrecoverable blocker (`SKILL.md`).

This is **one full review**, not a Bugbot or quality-rules-only pass. Cover Spec compliance, code/verify health, regression rules, and UI evidence together.

**UI in scope:** Spec Verification lists ≥1 path-only route. Else skip visuals. Spawn `sapphire-reviewer` **only if user asks**.

**Fixable:** Spec mismatch, quality-rule High, or verify failure correctable without expanding Out of scope or changing Requirement. At most **one** fix→push→re-verify cycle; then blocker.

**Medium** findings (Spec or R1–R12): note in PR body per `QUALITY-RULES.md`; do not block ready unless user asks to fix.

### Loop

1. Session Spec + Requirement (Linear read-only).
2. **PR trust** (below).
3. Compare Contract / Verification / Out of scope.
4. Allowlisted verify (`PHASE-CODER.md`).
5. Triggered R1–R12 from `QUALITY-RULES.md` against branch diff (`git diff` merge-base…HEAD).
6. UI in scope → `VISUAL-CAPTURE.md`. Else skip.
7. If fixable High: one fix→push→re-verify. Else blocker.
8. If pushed: return `pushed: true` — orchestrator re-checks **CI green** before ready.

**`ok: true`:** `/goal` met + local verify exit 0. Does **not** skip orchestrator CI re-check after a push.

## PR trust

1. Repo from `[repo=owner/name]` in Spec, else `masumi-network/sokosumi`.
2. `gh search prs --repo <owner/name> --state open "<issue-id>"`.
3. Optional: PR URL from session / user.
4. `gh pr view` — OPEN, issue id in body/title; use `headRefName`.
5. **Stop** if zero/ambiguous candidates or unvalidated foreign URL.

## Return

Structured keys only (`ok`, `prUrl`, `branch`, `verification`, `pushed`, `summary`, `blocker`). No Linear writes.
