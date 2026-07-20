# Linear MCP — Team Sapphire

Single-issue updates only. No child issues.

**Phase gates:** Every phase ends with `save_comment` + status row update before the next phase. See `PHASE-GATE.md` — skipping gates is a failed run.

## What goes on Linear

| Write to Linear | Do not write to Linear |
|-----------------|------------------------|
| `## Requirement` (preserve — do not rewrite without human approval) | `## Investigation` — session only |
| `## Sapphire status` table | `## Spec` — session only |
| Sapphire footer | Full investigation or spec in comments |
| Issue **state** (`Triage`/`In Progress` → `In Review`) | |
| Phase summary **comments** | |
| `**PR handoff**` comment | |
| `**Bugbot · medium (human review)**` comment (when ≥1 Medium) | |

Investigation and spec pass **in orchestrator session** to Tech Lead → Coder → Reviewer. See `SKILL.md` **Session artifacts**.

## Hard rules

- MCP only. Inspect `user-linear/tools/*.json` before writes.
- Never call a write tool without a complete `arguments` object.
- Stop if Linear MCP is not loaded. Tell the user:

  ```text
  Linear MCP is not loaded in this agent. In Cursor: Settings → MCP → enable `linear` (server id `user-linear`), then reload MCP servers. For Cloud Agents, open the agent run → MCP/tools → enable Linear for that agent (first delegated run often needs this once).
  ```
- Optional smoke test: `get_user` with `{ "query": "me" }`.
- **Never** append `## Investigation` or `## Spec` to the issue description.

## Issue description updates

Use `save_issue` with `id` = issue identifier.

### Status-only merge (required)

Every `save_issue` that sets `description` must:

1. Call `get_issue` first.
2. Start from the **full** existing `description`.
3. Keep **only** `## Requirement`, `## Sapphire status`, and the Sapphire footer (if present).
4. **Remove** `## Investigation`, `## Spec`, and any other Sapphire phase sections — legacy or new.
5. Update the status table row for the completed phase (or insert the initial table).
6. Pass the **entire** trimmed markdown in `description`.

Linear **replaces** the whole field — never send only a status block or you wipe `## Requirement`.

Prefer separate calls when possible: `save_issue` with `id` + `state` only (no `description`) for Reviewer **In Review** transition after status table is already saved.

### Initial Sapphire block (orchestrator start)

If `## Sapphire status` is missing, append after Requirement:

```markdown
## Sapphire status
| Phase | Status |
|-------|--------|
| Investigator | pending |
| Tech Lead | pending |
| Coder | pending |
| Reviewer | pending |
```

Do not add Investigation or Spec sections.

### After each phase

Update the status table row to `done`. Post a **short summary comment** — not the full investigation or spec.

**Order:** `save_comment` first, then `save_issue` with merged description. Do **not** start the next Sapphire phase until both succeed.

### Exit verification

Before the orchestrator returns to the user, `get_issue` + `list_comments` must confirm every `done` row has its comment header(s) and issue state matches ( **In Review** when Reviewer row is `done`). If the table still shows `pending` for a completed phase, or state is wrong, repair per `PHASE-GATE.md` **Repair** — do not exit.

### State transitions

| Action | `save_issue` |
|--------|----------------|
| Phases 1–3 running | `state: "In Progress"` (set when Sapphire starts if still `Triage`) |
| Reviewer pass | `state: "In Review"` |
| Human merge | Human sets `Done` — agents do not |

## Comments

Use structured headers for audit trail:

| Phase | Comment header |
|-------|----------------|
| Investigator | `**Sapphire · Investigator complete**` — 3–5 bullets |
| Tech Lead | `**Sapphire · Tech Lead complete**` — coder count, order, 3–5 bullets |
| Coder | `**PR handoff**`; optional `**Bugbot · medium (human review)**` when ≥1 Medium; `**Sapphire · Coder complete**` (verification exit 0, CI green, Bugbot summary) |
| Reviewer pass | `**Sapphire · Reviewer complete**` |
| Reviewer fail | `**Sapphire · Review failed**` |

## Write examples

Update status after Investigator (no investigation body on issue):

```json
{
  "server": "user-linear",
  "toolName": "save_issue",
  "arguments": {
    "id": "SOK-549",
    "description": "## Requirement\n\n…\n\n## Sapphire status\n| Phase | Status |\n|-------|--------|\n| Investigator | done |\n| Tech Lead | pending |\n| Coder | pending |\n| Reviewer | pending |\n\n---\n_Sapphire squad …_"
  }
}
```

Reviewer sets In Review (state only, after status table saved):

```json
{
  "server": "user-linear",
  "toolName": "save_issue",
  "arguments": {
    "id": "SOK-549",
    "state": "In Review"
  }
}
```

## Idempotency

Use `## Sapphire status` for progress on Linear; **session artifacts** decide whether a `done` row can be skipped — same rules as `SKILL.md` **Resume and idempotency**.

Legacy `## Investigation` / `## Spec` on the issue are ignored for skip logic; strip them on the next description write.

| Condition | Action |
|-----------|--------|
| Same session — Investigator = `done` + **session investigation** in context | Skip Investigator unless user asked to re-run |
| Same session — Tech Lead = `done` + **session spec** in context | Skip Tech Lead unless user asked to re-spec |
| New session — Investigator = `done` on Linear but no **session investigation** | Re-run Investigator before Tech Lead |
| New session — Tech Lead = `done` on Linear but no **session spec** | Re-run Tech Lead before Coder or Reviewer (Investigator first if investigation missing) |
| `**Sapphire · Coder complete**` documents verification exit 0, CI green, Bugbot 0 High + open PR + Coder = `done` + **session spec** in context | Skip Coder implementation; run Reviewer |
| `**PR handoff**` + open PR + Coder = `done`, missing or incomplete `**Sapphire · Coder complete**` + **session spec** in context | **Gate repair only** — run missing Pre-Reviewer gates 1–4 (local verification exit 0, CI green, Bugbot 0 High); post/update Phase 3 comments per `CODER.md`; do **not** re-implement unless gates fail |
| `**PR handoff**` + open PR, no **session spec** (new session) | Re-run Tech Lead before gate repair or Reviewer (Investigator first if investigation missing) |
| All status rows = `done`, issue not `In Review` | Reviewer cleanup — rebuild session spec when missing; if Coder complete invalid → **gate repair only** via step 8; if valid → Phase 4 + post-fix gates + **Completion** gate + **Exit gate** |

## Post-run response

Return issue id/URL, phases completed, Linear state, PR URL if any.

Confirm exit gate passed: every `done` row has comment(s), no stale `pending` rows for finished work, and issue state matches ( **In Review** when Reviewer is `done`). If not, say what was repaired or what is still missing.
