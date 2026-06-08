# Linear MCP

Use this only after the user approves the PRD.

## Defaults

```typescript
const LINEAR_TEAM = "SOK";
const LINEAR_PROJECT = "Sokosumi";
const LINEAR_STATE = "Todo";
const LINEAR_LABELS = ["Feature", "Bug", "Improvement"] as const;
```

Create exactly one Linear issue with:

- Team: `SOK`
- Project: `Sokosumi`, unless the user gave an override
- State: `Todo`
- Label: exactly one of `Feature`, `Bug`, `Improvement`
- Description: the approved PRD markdown

## Hard rules

- Use MCP only. Do not use `LINEAR_API_KEY`, curl, browser automation, or GraphQL fallback.
- Before any `CallMcpTool`, list and read the MCP tool descriptor JSON files.
- Use the Linear tool names and parameter names below only after confirming them against descriptors.
- Never call a write tool without a complete `arguments` object.
- Stop if Linear MCP is not loaded in the current agent.
- Do not create the issue until the user explicitly approves the PRD.

## MCP health check

Before creating the issue:

1. Inspect the MCP folder for `user-linear/tools/*.json`.
2. Read descriptors for tools that list teams, projects, states/statuses, labels, and create issues.
3. If descriptors are missing, check whether the current agent exposes the `user-linear` server.
4. If `CallMcpTool` says the server does not exist, stop and say:

   ```text
   Linear MCP is configured but not loaded in this agent. Reload MCP servers in Cursor Settings, then rerun approval.
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
        "url": "https://mcp.linear.app/sse"
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
| `create_issue` | Create the approved PRD issue |

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
   - Use override only if the approved PRD says so.
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

5. Create issue
   - Use `create_issue`.
   - Required fields: `title`, `team`.
   - Supported fields include `description`, `project`, `state`, `labels`, `priority`, `assignee`, `cycle`, `dueDate`, `parentId`, `links`.
   - Use names directly: `team: "SOK"`, `project: "Sokosumi"`, `state: "Todo"`, `labels: ["Feature"]`.
   - Return identifier, URL, and applied label.

## Write-call shape

Use this shape after confirming the descriptor:

```json
{
  "server": "user-linear",
  "toolName": "create_issue",
  "arguments": {
    "title": "feat(scope): concise title",
    "description": "Approved PRD markdown",
    "team": "SOK",
    "project": "Sokosumi",
    "state": "Todo",
    "labels": ["Feature"]
  }
}
```

Do not send empty `arguments`.

## Description body

Use the approved PRD as the issue description. Do not add process notes, MCP logs, or hidden reasoning.

Keep these top fields visible near the top:

```markdown
**Goal:** ...

**Linear:** project Sokosumi - state Todo - label Feature
```

## Post-create response

Return:

- Linear identifier, for example `SOK-123`
- URL
- Project
- State
- Label

Keep it short.
