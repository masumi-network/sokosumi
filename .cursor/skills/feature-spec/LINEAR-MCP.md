# Linear MCP

Run immediately after the spec agent drafts the PRD. No approval gate.

Creates an **implementation** issue (full PRD), a **Confirm PRD** sub-task, optionally links a **requirement** parent, and delegates to **Cursor** for Cloud Agent.

## Defaults

```typescript
const LINEAR_TEAM = "SOK";
const LINEAR_PROJECT = "Sokosumi";
const LINEAR_STATE = "Todo";
const LINEAR_LABELS = ["Feature", "Bug", "Improvement"] as const;
const LINEAR_REPO_HINT = "[repo=masumi-network/sokosumi]";
const CURSOR_DELEGATE = "Cursor";
```

Create exactly one implementation issue with:

- Team: `SOK`
- Project: `Sokosumi`, unless the user gave an override
- State: `Todo`
- Label: exactly one of `Feature`, `Bug`, `Improvement`
- Description: PRD markdown, with repo hint near the top
- `parentId`: requirement issue id when intake came from one (e.g. `SOK-537`)
- `delegate`: `"Cursor"` when user wants Cloud Agent handoff (default unless they opt out)

## Hard rules

- Use MCP only. Do not use `LINEAR_API_KEY`, curl, browser automation, or GraphQL fallback.
- Before any MCP write call, inspect the available Linear tool schema/descriptor for the current runtime.
- Use the Linear tool names and parameter names below only after confirming them against descriptors.
- Never call a write tool without a complete `arguments` object.
- Stop if Linear MCP is not loaded in the current agent.
- Do not wait for PRD approval before creating issues or delegating to Cursor.

## Runtime notes

| Agent | Linear MCP behavior |
|-------|---------------------|
| Cursor | Use `CallMcpTool` with server `user-linear` when available. Read descriptors from the MCP filesystem before calls. |
| Claude Code | Use the configured Linear MCP server if available. Inspect tool schemas before calls. |
| Codex | Use the configured Linear MCP server if available. If Codex has no Linear MCP tools, return the draft PRD in chat and report the missing MCP access. |

## MCP health check

Before creating the issue:

1. Inspect the MCP folder for `user-linear/tools/*.json`.
2. Read descriptors for tools that list teams, projects, states/statuses, labels, and create issues.
3. If descriptors are missing, check whether the current agent exposes the `user-linear` server.
4. If the runtime says the Linear server does not exist, stop and say:

   ```text
   Linear MCP is configured but not loaded in this agent. Reload MCP servers in Cursor Settings, then rerun the spec agent.
   ```

Known config in this workspace:

- Server identifier: `user-linear`
- Server name: `linear`
- Global config: `~/.cursor/mcp.json`
- Config shape:

  ```json
  {
    "mcpServers": {
      "linear": {
        "url": "https://mcp.linear.app/mcp"
      }
    }
  }
  ```

Expected tools after reload:

| Tool | Use |
|------|-----|
| `list_teams` | Resolve `SOK` / Sokosumi team |
| `list_projects` | Resolve `Sokosumi` project |
| `list_issue_statuses` | Confirm `Todo` state |
| `list_issue_labels` | Confirm `Feature`, `Bug`, or `Improvement` |
| `get_issue` | Load requirement issue for intake |
| `save_issue` | Create implementation issue; set `parentId`, `delegate` |
| `save_comment` | Link implementation issue back on requirement issue |

## Resolution order

Use names directly. Linear MCP accepts names for team, project, state, and labels.

1. Resolve team
   - Call `list_teams` with `{ "query": "SOK", "limit": 10 }` when supported, or list teams and match key/name.
   - Prefer exact key `SOK`.
   - If key is unavailable, match `Sokosumi`.
   - If multiple teams match, ask one question.

2. Resolve project
   - Call `list_projects` with `{ "query": "Sokosumi", "team": "SOK", "limit": 10 }` when supported.
   - Default exact name: `Sokosumi`.
   - Use override only if the PRD says so.
   - If multiple projects match, ask one question.

3. Resolve state
   - Call `list_issue_statuses` with `{ "team": "SOK" }`.
   - Match exact name `Todo`.
   - If `Todo` is absent, use the team's first unstarted/backlog state only if the descriptor exposes state type/category.
   - If no safe match, ask one question.

4. Resolve label
   - Use the PRD-inferred or user-overridden label.
   - Call `list_issue_labels` with `{ "team": "SOK", "name": "<label>", "limit": 10 }` when supported.
   - Match exact name: `Feature`, `Bug`, or `Improvement`.
   - Apply exactly one label.
   - If the label is missing, stop and report the missing label.

5. Create implementation issue
   - Use `save_issue` (do not pass `id` when creating).
   - Required fields: `title`, `team`.
   - Supported fields include `description`, `project`, `state`, `labels`, `priority`, `assignee`, `delegate`, `parentId`, `cycle`, `dueDate`, `links`.
   - Use names directly: `team: "SOK"`, `project: "Sokosumi"`, `state: "Todo"`, `labels: ["Feature"]`.
   - Set `parentId` to the requirement issue identifier when applicable.
   - Set `delegate: "Cursor"` when handing off to Cloud Agent.
   - Return identifier, URL, applied label, parent link, and delegate status.

6. Create Confirm PRD sub-task
   - Use `save_issue` (do not pass `id` when creating).
   - `title`: `chore(spec): confirm PRD`
   - `team`: `SOK`
   - `project`: `Sokosumi`
   - `state`: `Todo`
   - `labels`: `["Improvement"]`
   - `parentId`: implementation issue identifier (e.g. `SOK-549`)
   - Do **not** set `delegate`.
   - `description`:

     ```markdown
     **Goal:** Confirm the implementation PRD matches the requirement intent.

     **Parent:** SOK-XXX (implementation issue — link in Linear)

     **Checklist:**
     - [ ] Problem and goal match the requirement
     - [ ] Confirmed decisions respected
     - [ ] Out of scope is correct
     - [ ] Key decisions look right

     Non-blocking. Cursor Cloud Agent may already be running on the parent issue.
     If the PRD is wrong, comment on the parent issue or stop the Cloud Agent.
     ```

7. Link back (when requirement parent exists)
   - Use `save_comment` on the requirement issue:
   - Body: short note + link to implementation issue (e.g. "Implementation PRD: SOK-549 …").

## Write-call shape

Use this shape after confirming the descriptor:

```json
{
  "runtime": "Cursor CallMcpTool example",
  "server": "user-linear",
  "toolName": "save_issue",
  "arguments": {
    "title": "feat(scope): concise title",
    "description": "[repo=masumi-network/sokosumi]\n\nPRD markdown",
    "team": "SOK",
    "project": "Sokosumi",
    "state": "Todo",
    "labels": ["Feature"],
    "parentId": "SOK-537",
    "delegate": "Cursor"
  }
}
```

Do not send empty `arguments`.

## Description body

Use the PRD as the implementation issue description. Do not add process notes, MCP logs, or hidden reasoning.

Keep these top fields visible near the top:

```markdown
[repo=masumi-network/sokosumi]

**Goal:** ...

**Requirement:** SOK-XXX (when applicable)

**Linear:** project Sokosumi - state Todo - label Feature
```

## Cursor Cloud Agent

- Prefer `delegate: "Cursor"` on `save_issue` for immediate handoff.
- Alternative: comment `@Cursor implement per PRD. [repo=masumi-network/sokosumi]` via `save_comment`.
- Optional team automation: see `CURSOR-AUTOMATION.md`.

## Post-create response

Return:

- Implementation issue identifier and URL
- Confirm PRD sub-task identifier and URL
- Project
- State
- Label
- Requirement parent link (if any)
- Delegate: Cursor yes/no
