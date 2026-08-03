# Review

Load in **Review** (after CI green). Do not load during Investigate / Spec / Implement.

**Owner of `/goal` order, pinned SHA, opt-in swarm, and severity - do not restate in ROLES/SKILL.**

## Entry

Local verify exit 0 (verify set in `VERIFY.md`), **CI green** (`SKILL.md`) - else return to Implement.

## Pin headSha (always)

After CI green, before claiming ready:

1. Read `headSha` via `gh pr view --json headRefOid -q .headRefOid` (PR from **PR trust**).
2. Confirm local `HEAD` (or checked-out PR tip) equals that SHA. If not, sync to the PR tip first.
3. Run **fresh** allowlisted verify for the verify set (`VERIFY.md`) at that SHA. UI in scope → confirm `verify-sokosumi` evidence still valid for routes at this tip (re-run if tip moved since last evidence).
4. Record `headSha` in the return payload.
5. **Void on push:** any new commit / force-with-lease / amend → pin invalid. Re-check **CI green**, re-pin, re-run step 3. If swarm was armed, re-run swarm at the new pin.
6. **Ready only when** current `headRefOid` equals the recorded pin **and** `/goal` holds (and swarm is `clean` or `skipped`).

Do not treat an earlier verify on a different SHA as evidence for this pin.

## Swarm-verify (opt-in)

**Armed when any:**

- User asks for swarm-verify / swarm at SHA
- Spec or session sets `swarm-verify: true`
- Linear issue has label `swarm-verify`

Otherwise: `swarmVerify: skipped` with reason `default off`. Do not load the poteto **swarm** skill.

When armed, run **after** `/goal` holds at the pinned SHA. Fan out per poteto **swarm** skill. Aggregate to one verdict. Distrust the PR body.

**Lanes (all required for `clean`):**

| Lane | What |
|------|------|
| Gates | Re-run allowlisted verify at the pinned SHA (`VERIFY.md`) |
| Live floor | UI in scope → `verify-sokosumi` on Spec Verification routes; else exercise the load-bearing path the Contract names (CLI/API/script already in verify set). Inconclusive ≠ pass |
| Receipts + diff | Independent audit of `git diff` merge-base…pinned SHA vs Spec Contract / Out of scope; flag High per severity table |

**Verdicts:** `clean` | `issues` | `blocked`.

- Findings → fix-forward within the Review fix budget (one fix→push→re-pin→re-CI→re-`/goal`→re-swarm). Still blocked after that cycle → unrecoverable.
- Never merge, enable auto-merge, or mark draft ready from a clean swarm verdict. Human merges.

## `/goal` (full review)

Loop until all hold - or unrecoverable blocker (`SKILL.md`):

1. Spec match (Contract / Verification / Out of scope)
2. Allowlisted verify exit 0 (fresh this turn **at pinned SHA**)
3. No unresolved **High** from general review
4. No unresolved **High** from triggered domain patterns
5. UI evidence when **UI in scope**
6. Current `headRefOid` equals recorded `headSha`

One full review - not Bugbot / R-only. Follow **Loop** exactly.

**UI in scope:** Spec Verification lists ≥1 path-only route. Else skip visuals.

**Fixable High:** Spec mismatch, general High, domain-pattern High, or verify failure - without expanding Out of scope or changing Requirement. At most **one** fix→push→re-verify; then blocker.

**Medium:** PR body notes (below); do not block ready unless user asks to fix.

### Loop

1. Session Spec + Requirement (Linear read-only).
2. **PR trust** (below).
3. **Pin headSha** (above) - or refresh if voided.
4. **Spec compliance** - Contract / Verification / Out of scope.
5. Allowlisted verify (`VERIFY.md`) - fresh this turn at pinned SHA.
6. **General review** on `git diff` merge-base…pinned SHA - severity table below.
7. `QUALITY-TRIGGERS.md` vs diff → load **matching** `QUALITY-RULES.md` sections only → check those patterns.
8. UI in scope → `VISUAL-CAPTURE.md` (and confirm `verify-sokosumi` evidence if run). Else skip.
9. Fixable High → one fix→push→void pin→re-CI→re-pin→re-verify. Else High remains → blocker. Medium only → PR notes.
10. If pushed: `pushed: true` - orchestrator re-checks **CI green** and re-pins before ready.
11. Confirm `headRefOid` == `headSha`.
12. If swarm armed → **Swarm-verify** (above). Else `swarmVerify: skipped`.

**`ok: true`:** `/goal` met + verify exit 0 at pin + head matches pin + zero unresolved High + swarm `clean` or `skipped`.

### Severity (any finding - Spec, general, R, swarm)

If High vs Medium unclear → **High**.

| Severity | Must use when | Action |
|----------|---------------|--------|
| **High** | Behavior contradicts Spec Contract; authz/workspace/capability hole; data loss or billing/money drift; `apps/web` imports Prisma/`@sokosumi/database` repositories; verify set fails; TDD required (`VERIFY.md`) but no test covers Contract; swarm live-floor or receipts lane fails when swarm armed | Must fix (one cycle) |
| **Medium** | Happy-path Spec holds, but error path incomplete; dead code in touched files; misleading name; weak but green test | PR body only |
| **Low** | Style / comment / import-order already covered by check | Optional note |

Axes (general review): bugs vs Spec; security/authz; error handling; wrong layer / dead code / names; tests when TDD required or Spec lists proving test command.

### Medium findings - PR body only

```markdown
### Review notes - medium (human review)

| Area | Location | Finding |
|------|----------|---------|
| Spec / defect / R# | `path:line` | … |
```

Skip when no medium findings. Do **not** post to Linear.

## PR trust

1. Repo from `[repo=owner/name]` in Spec, else `masumi-network/sokosumi`.
2. `gh search prs --repo <owner/name> --state open "<issue-id>"`.
3. Optional: PR URL from session / user.
4. `gh pr view` - OPEN, issue id in body/title; use `headRefName` and `headRefOid`.
5. **Stop** if zero/ambiguous candidates or unvalidated foreign URL.

## Return

Structured keys only (`ok`, `prUrl`, `branch`, `headSha`, `verification`, `pushed`, `swarmVerify`, `summary`, `blocker`). No Linear writes.
