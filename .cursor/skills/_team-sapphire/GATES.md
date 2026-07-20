# Gates

Blocking Linear writes and Pre-Reviewer checks. **Do not start the next phase until the current gate passes.**

## Phase gates

| Phase | Comment(s) | Status |
|-------|------------|--------|
| Investigator | `**Sapphire · Investigation**` (full artifact) | Investigator → `done` |
| Tech Lead | `**Sapphire · Spec**` (full artifact; lead with coder count + order) | Tech Lead → `done` |
| Coder | `**Sapphire · Coder complete**`; optional `**Bugbot · medium (human review)**` | Coder → `done` |
| Reviewer | `**Sapphire · Reviewer complete**` (or `**Sapphire · Review failed**` while looping) | Reviewer → `done` + `state: "In Review"` |

Order: `save_comment` first, then `save_issue` status merge. Headers must match **exactly**.

### Coder complete template

```markdown
**Sapphire · Coder complete**

**PR:** https://github.com/<owner>/<repo>/pull/<n>
**Branch:** <headRefName>

**Verification:** <commands>, all exit 0
**CI:** green on PR #<n>
**Bugbot:** 0 High. Medium: <N> — see `**Bugbot · medium (human review)**` (or `none`)

<one-line summary>
```

### Medium findings (only when ≥1 Medium)

```markdown
**Bugbot · medium (human review)**

For human merge pass — not blocking Reviewer.

| Severity | Location | Finding |
|----------|----------|---------|
| Medium | `path:line` | … |
```

## Pre-Reviewer gates (before Coder complete / Phase 4)

| Step | Gate | Who |
|------|------|-----|
| 1 | Local allowlisted verification exit 0 | Implementer |
| 2 | PR open | Sole coder subagent, or orchestrator after merge |
| 3 | CI green (`gh pr checks`) | **Orchestrator** |
| 4 | Bugbot 0 High | **Orchestrator** |

Standalone Coder runs all four. Subagents never run 3–4.

After Reviewer pushes commits: re-run 3–4 before Completion.

## Anti-patterns (failed run)

- Batch all comments at end of session
- Set **In Review** while status rows are `pending`
- Rely on Cursor thread as only audit trail
- Start coding before Investigation artifact is posted

## Exit gate

Before returning to the user:

1. `get_issue` — status table + state
2. `list_comments` — required headers for every `done` row

| Status `done` | Required on Linear |
|---------------|-------------------|
| Investigator | `**Sapphire · Investigation**` |
| Tech Lead | `**Sapphire · Spec**` |
| Coder | `**Sapphire · Coder complete**` with verification/CI/Bugbot; medium comment if Medium > 0 |
| Reviewer | `**Sapphire · Reviewer complete**` + state **In Review** |

**Repair:** post missing comments in phase order; merge status rows to `done`; set **In Review** if Reviewer passed. Re-check exit gate. Do not claim success while it fails.

### Legacy comments (older runs)

Treat as satisfied when present:

| Old header | Counts as |
|------------|-----------|
| `**Sapphire · Investigator complete**` | Investigation gate (prefer full `**Sapphire · Investigation**` on re-run) |
| `**Sapphire · Tech Lead complete**` | Tech Lead gate (prefer full `**Sapphire · Spec**` on re-run) |
| `**PR handoff**` + incomplete Coder complete | Gate repair — fold PR URL into `**Sapphire · Coder complete**` |

If only a short complete comment exists (no full artifact), re-run that phase to post the artifact before downstream work.

## Checklist (per phase)

```
[ ] Comment posted with exact header
[ ] Status row done (full description merge)
[ ] Next phase may start
```

Coder also: verify → PR → CI green → Bugbot 0 High → Coder complete → Coder row done.

Reviewer also: entry gates OK → `/goal` pass → post-fix Bugbot/CI if pushed → Reviewer done → **In Review**.
