# Linear MCP — Requirement Issues

Run **only after** the user approves the draft in chat.

Creates a **requirement** issue (high level). Does **not** create an implementation issue — that is feature-spec's job.

## Defaults

```typescript
const LINEAR_TEAM = "SOK";
const LINEAR_PROJECT = "Sokosumi";
const LINEAR_STATE = "Todo";
const LINEAR_LABELS = ["Feature", "Bug", "Improvement"] as const;
```

Create exactly one requirement issue with:

- Team: `SOK`
- Project: `Sokosumi`, unless user override
- State: `Todo`
- Label: exactly one of `Feature`, `Bug`, or `Improvement`
- Description: approved requirement markdown from `REQUIREMENT-TEMPLATE.md`
- Title: user-approved proposed title (Conventional Commit style when possible)
- Do **not** set `delegate` on the requirement issue itself
- Do **not** set `parentId` unless user asked to file under an epic/parent

## Hard rules

- Use MCP only. No browser automation, curl, or raw API.
- Inspect Linear tool descriptors before write calls.
- Never call a write tool without a complete `arguments` object.
- Stop if Linear MCP is not loaded.
- **Never create before user approval.**

## MCP health check

Same as `../feature-spec/LINEAR-MCP.md`:

1. Inspect `user-linear/tools/*.json`.
2. If server missing, stop and ask user to reload MCP in Cursor Settings.

Expected tools: `list_teams`, `list_projects`, `list_issue_statuses`, `list_issue_labels`, `get_issue`, `save_issue`, `save_comment`.

## Resolution order

1. Team → `SOK`
2. Project → `Sokosumi` (or override)
3. State → `Todo`
4. Label → exact match from draft
5. Create requirement issue via `save_issue` (no `id`, no `delegate`)

## Write-call shape

```json
{
  "server": "user-linear",
  "toolName": "save_issue",
  "arguments": {
    "title": "feat(scope): concise requirement title",
    "description": "Approved requirement markdown",
    "team": "SOK",
    "project": "Sokosumi",
    "state": "Todo",
    "labels": ["Feature"]
  }
}
```

## Description body

Use the approved requirement text from `REQUIREMENT-TEMPLATE.md` only. No MCP logs or agent reasoning.

Do **not** add chat-only draft lines (`**Requirement draft:** …`), `[repo=…]`, verification commands, or PRD sections — those belong on the implementation issue after feature-spec runs.

Optional footer the agent may add after approval:

```markdown
---
_Requirement drafted via _task skill. Implementation PRD: pending spec agent._
```

## Post-create

1. Return requirement identifier and URL.
2. Continue to `HANDOFF.md` when `handoffToPrd` is true.
3. If handoff is skipped, tell the user to run feature-spec with the issue id.
