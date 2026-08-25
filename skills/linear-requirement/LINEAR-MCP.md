# Linear MCP — Requirement Issues

Run **only after** the user approves the draft in chat.

Creates or updates **one** Linear issue with `## Requirement`. No child issues.

Only touch the fields documented here — no other Linear side effects.

Call Linear tools by whatever qualified name **this session** exposes (`save_issue`, `linear__save_issue`, `mcp__…__save_issue`, and the matching `get_issue` / `list_issues` / `get_user` names). Inspect the live input schema before each call. Pass the fields below; omit harness wrapper keys (`server`, `toolName`) unless this session’s schema requires them.

## Defaults

```typescript
const LINEAR_TEAM = "SOK";
// Marketplace project — pass slug/ID to save_issue, not "Sokosumi" (ambiguous; wrong spelling).
const LINEAR_PROJECT = "sokosumi-6357694ddd23"; // display name: Sōkosumi
const LINEAR_PROJECT_ID = "a51c9d61-b1a4-457e-a382-1277e1f7be4a";
const LINEAR_STATE = "Triage";
const LINEAR_PRIORITY = 3; // Medium — 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
const LINEAR_ASSIGNEE = null; // omit on create unless user overrides
const LINEAR_LABELS = ["Feature", "Bug", "Improvement"] as const;
```

Also in repo: `.linear.toml` → `project_id = "sokosumi-6357694ddd23"`.

## Required on create (never omit)

Every `save_issue` **create** call (no `id`) must include **all** of:

| Field | Default |
|-------|---------|
| `title` | user-approved **product** title (no `feat:` / `fix:` prefix) |
| `description` | approved requirement (`## Requirement`) |
| `team` | `SOK` |
| `project` | `sokosumi-6357694ddd23` (Sōkosumi marketplace) |
| `state` | `Triage` |
| `priority` | `3` (Medium) |
| `labels` | exactly one of `Feature`, `Bug`, or `Improvement` |

**Do not set `assignee` on create** unless the user explicitly asked for an assignee during intake.

Override other fields only when the user explicitly passed a different value during intake.

**Never omit `project`.** If the user did not name a project, always pass `"project": "sokosumi-6357694ddd23"`.

**Do not pass `"Sokosumi"`.** Linear’s marketplace project is **Sōkosumi** (macron on the first o). The plain string `Sokosumi` does not resolve — the workspace also has Sokosumi Social Media, Sokosumi Task Board, etc. Use the slug (or `LINEAR_PROJECT_ID`) in every `save_issue` call.

Do **not** set `parentId` unless user asked to file under an epic/parent.

## Update existing issue

When publish target is `update:SOK-XXX` and the user approved the draft:

1. `get_issue` immediately before write — `save_issue` **replaces** the entire `description` when `description` is sent.
2. Start from the full current description. Replace or insert `## Requirement` with the approved body. Preserve any other sections already on the issue.
3. Call `save_issue` with `id` + merged `description`. Also set `title` when the approved draft changed it.
4. `labels` **replaces the full set**. If the type label (`Feature` / `Bug` / `Improvement`) changed, send that type label **plus every existing label that is not one of those three**. Omit `labels` when the type label is unchanged.
5. Set `priority`, `assignee`, or `project` **only** when the user explicitly overrode them in the approved draft.
6. **Never set `state` on update** unless the user explicitly asked to change state. Do **not** reset `In Progress` / `In Review` / etc. to `Triage` because that is the create default.
7. Do **not** create a second issue.

## Hard rules

- Use MCP only. No browser automation, curl, or raw API.
- Inspect Linear tool descriptors before write calls.
- Never call a write tool without a complete arguments object matching the live schema.
- Stop if Linear MCP is not loaded.
- **Never create or update before user approval.**
- **Never create without `project`** — same rule as `state` and `priority` on create.
- **Never set `assignee` on create** unless the user explicitly requested one.

## MCP health check

Run **before** any Linear write (after user approval):

1. List this session’s Linear tools and read the `save_issue` / `get_issue` schemas.
2. If those tools are missing, stop and tell the user:

   ```text
   Linear MCP is not loaded in this agent. Enable the Linear MCP server for this session, then retry. Do not file the issue via browser, curl, or the Linear REST API.
   ```

3. Optional smoke test: `get_user` with `{ "query": "me" }` to confirm auth before `save_issue`.

Expected tool **names** (harness prefix may differ): `list_teams`, `list_projects`, `list_issue_statuses`, `list_issue_labels`, `list_issues`, `get_user`, `get_issue`, `save_issue`, `save_comment`.

## Resolution order (create only)

1. Team → `SOK`
2. Project → `sokosumi-6357694ddd23` / Sōkosumi (or user override)
3. State → `Triage`
4. Priority → `3` (Medium) unless user override
5. Assignee → omit (unassigned) unless user override
6. Label → exact match from draft
7. Create via `save_issue` without `id` — pass the full required create field set above (no `assignee` unless overridden)

## Post-write verify

Immediately after create or update:

1. `get_issue` with the identifier.
2. **Create only:** if any create default is missing or wrong and the user did not override it, patch with `save_issue` + `id`:
   - `projectId` not `a51c9d61-b1a4-457e-a382-1277e1f7be4a` (or `project` not `Sōkosumi`) → `"project": "sokosumi-6357694ddd23"`
   - assignee set and user did **not** request one → `"assignee": null`
   - state not `Triage` → `"Triage"`
   - priority not Medium (`3`) → `3`
3. **Update:** do **not** patch state/assignee/priority/project back to create defaults. Only confirm `## Requirement` (and approved title/labels) landed. If labels were sent, confirm non-type labels (e.g. `ready-for-agent`, `needs-info`) are still present.
4. Return the issue id and URL.

## Write-call arguments (create)

Pass these fields to this session’s `save_issue` tool:

```json
{
  "title": "History view for past agent jobs",
  "description": "## Requirement\n\n**Problem:** …",
  "team": "SOK",
  "project": "sokosumi-6357694ddd23",
  "state": "Triage",
  "priority": 3,
  "labels": ["Feature"]
}
```

## Write-call arguments (update)

```json
{
  "id": "SOK-XXX",
  "title": "History view for past agent jobs",
  "description": "## Requirement\n\n**Problem:** …\n\n## Other preserved section\n…"
}
```

Omit `state` on update unless the user explicitly asked to change it. Include `labels` only when the type label changed, and then send the full preserved set (see **Update existing issue**). Include `priority` / `assignee` / `project` only when the approved draft overrode them.

## Description body

Use the approved requirement from `REQUIREMENT-TEMPLATE.md`. No MCP logs or agent reasoning.

Do **not** add chat-only draft lines, `[repo=…]`, `## Spec`, or verification commands on create/update.

## Post-write

1. Return issue identifier and URL.
2. Stop. Do not start `/to-spec`, `/implement`, or any other engineering flow in this session.
