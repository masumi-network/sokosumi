# Linear MCP — Requirement Issues

Run **only after** the user approves the draft in chat.

Creates **one** Linear issue with `## Requirement`. No child issues. No Sapphire handoff.

## Defaults

```typescript
const LINEAR_TEAM = "SOK";
// Marketplace project — pass slug/ID to save_issue, not "Sokosumi" (ambiguous; wrong spelling).
const LINEAR_PROJECT = "sokosumi-6357694ddd23"; // display name: Sōkosumi
const LINEAR_PROJECT_ID = "a51c9d61-b1a4-457e-a382-1277e1f7be4a";
const LINEAR_STATE = "In Progress";
const LINEAR_PRIORITY = 3; // Medium — 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
const LINEAR_ASSIGNEE = "me";
const LINEAR_LABELS = ["Feature", "Bug", "Improvement"] as const;
```

Also in repo: `.linear.toml` → `project_id = "sokosumi-6357694ddd23"`.

## Required on create (never omit)

Every `save_issue` **create** call (no `id`) must include **all** of:

| Field | Default |
|-------|---------|
| `title` | user-approved proposed title |
| `description` | approved requirement (`## Requirement`) |
| `team` | `SOK` |
| `project` | `sokosumi-6357694ddd23` (Sōkosumi marketplace) |
| `state` | `In Progress` |
| `priority` | `3` (Medium) |
| `assignee` | `me` |
| `labels` | exactly one of `Feature`, `Bug`, `Improvement` |

Override only when the user explicitly passed a different value during intake.

**Never omit `project`.** If the user did not name a project, always pass `"project": "sokosumi-6357694ddd23"`.

**Do not pass `"Sokosumi"`.** Linear’s marketplace project is **Sōkosumi** (macron on the first o). The plain string `Sokosumi` does not resolve — the workspace also has Sokosumi Social Media, Sokosumi Task Board, etc. Use the slug (or `LINEAR_PROJECT_ID`) in every `save_issue` call.

Do **not** set `delegate` on create.

Do **not** set `parentId` unless user asked to file under an epic/parent.

## Hard rules

- Use MCP only. No browser automation, curl, or raw API.
- Inspect Linear tool descriptors before write calls.
- Never call a write tool without a complete `arguments` object.
- Stop if Linear MCP is not loaded.
- **Never create before user approval.**
- **Never create without `project`** — same rule as `assignee`, `state`, and `priority`.

## MCP health check

Run **before** any Linear write (after user approval):

1. Inspect Linear MCP tool schemas (e.g. via `GetMcpTools` for the Linear server).
2. If tools are missing or `CallMcpTool` reports the server does not exist, stop and tell the user:

   ```text
   Linear MCP is not loaded in this agent. In Cursor: Settings → MCP → enable `linear` (server id `user-linear`), then reload MCP servers. For Cloud Agents, open the agent run → MCP/tools → enable Linear for that agent (first delegated run often needs this once).
   ```

3. Optional smoke test: `get_user` with `{ "query": "me" }` to confirm auth before `save_issue`.

Expected tools: `list_teams`, `list_projects`, `list_issue_statuses`, `list_issue_labels`, `get_user`, `get_issue`, `save_issue`, `save_comment`.

## Resolution order

1. Team → `SOK`
2. Project → `sokosumi-6357694ddd23` / Sōkosumi (or user override)
3. State → `In Progress`
4. Priority → `3` (Medium) unless user override
5. Assignee → `me` unless user override
6. Label → exact match from draft
7. Create issue via `save_issue` (no `id`, no `delegate`) — pass the full required field set above

## Post-create verify

Immediately after create:

1. `get_issue` with the new identifier.
2. If any default is missing or wrong and the user did not override it, patch with `save_issue` + `id`:
   - `projectId` not `a51c9d61-b1a4-457e-a382-1277e1f7be4a` (or `project` not `Sōkosumi`) → `"project": "sokosumi-6357694ddd23"`
   - no assignee → `"me"`
   - state not `In Progress` → `"In Progress"`
   - priority not Medium (`3`) → `3`
3. Return the issue id and URL. Do **not** set `delegate` or append Sapphire sections.

## Write-call shape

```json
{
  "server": "user-linear",
  "toolName": "save_issue",
  "arguments": {
    "title": "feat(scope): concise requirement title",
    "description": "## Requirement\n\n**Problem:** …",
    "team": "SOK",
    "project": "sokosumi-6357694ddd23",
    "state": "In Progress",
    "priority": 3,
    "assignee": "me",
    "labels": ["Feature"]
  }
}
```

## Description body

Use the approved requirement from `REQUIREMENT-TEMPLATE.md`. No MCP logs or agent reasoning.

Do **not** add chat-only draft lines, `[repo=…]`, `## Spec`, verification commands, or `## Sapphire status` on create.

## Post-create

1. Return issue identifier and URL.
2. Stop — do not start Team Sapphire or set `delegate`.
