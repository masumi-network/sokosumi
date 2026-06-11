# Linear MCP

Run immediately after the spec agent drafts the PRD. No approval gate.

Creates an **implementation** issue (full PRD), a **Confirm PRD** sub-task, a **Verify implementation** sub-task, optionally links a **requirement** parent, then delegates to **Cursor** for Cloud Agent. **Delegate last** — the coding agent must find the verify sub-task when it finishes.

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
- `delegate`: set on the implementation issue **after** Confirm and Verify sub-tasks exist — not on initial `save_issue` create

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
| `save_issue` | Create implementation issue (`parentId`); update with `id` + `delegate` after sub-tasks exist |
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

5. Idempotency (when publishing under a requirement parent — **always** run for direct requirement intake **and** Write PRD sub-task intake)
   - **Resolve requirement id:** Use intake id when intake is the requirement issue. When intake is a Write PRD sub-task (`chore(spec): write implementation PRD`), use its parent requirement id — same value as implementation `parentId`.
   - Load the requirement issue and inspect existing children (or search siblings under the same parent).
   - If a child already exists whose description contains `[repo=…]` and title is **not** `chore(spec): write implementation PRD`, treat it as the implementation issue — **stop**; do not create another implementation issue or sub-tasks.
   - **Where to comment** (one target only — pick by intake path):
     - **Write PRD sub-task path:** Intake was a Write PRD sub-task (`chore(spec): write implementation PRD`, child of the requirement). Use `save_comment` on **that sub-task** with the existing implementation issue link.
     - **Manual requirement intake:** Intake was the requirement issue directly (e.g. user said `run feature-spec for SOK-XXX`, or `handoffToPrd: false` with no Write PRD sub-task). Use `save_comment` on the **requirement** issue with the same link.
   - Comment body (either target):

     ```markdown
     Implementation PRD already exists: SOK-YYY (link). Idempotency check skipped duplicate publish.
     ```

     Replace `SOK-YYY` with the existing implementation issue identifier.
   - Return early per **Post-idempotency response** below — do not run steps 6–10.

6. Create implementation issue
   - Use `save_issue` (do not pass `id` when creating).
   - Required fields: `title`, `team`.
   - Supported fields include `description`, `project`, `state`, `labels`, `priority`, `assignee`, `parentId`, `cycle`, `dueDate`, `links`.
   - Use names directly: `team: "SOK"`, `project: "Sokosumi"`, `state: "Todo"`, `labels: ["Feature"]`.
   - Set `parentId` to the requirement issue identifier when applicable.
   - Do **not** set `delegate` on create — a fast Cloud Agent could finish before step 8 creates the verify sub-task.
   - Return identifier, URL, applied label, and parent link.

7. Create Confirm PRD sub-task
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

8. Create Verify implementation sub-task
   - Use `save_issue` (do not pass `id` when creating).
   - `title`: `chore(review): verify implementation against PRD`
   - `team`: `SOK`
   - `project`: `Sokosumi`
   - `state`: `Todo`
   - `labels`: `["Improvement"]`
   - `parentId`: implementation issue identifier
   - Do **not** set `delegate` — coding agent delegates after PR is open.
   - `description`:

     ```markdown
     **Goal:** Verify the PR matches the parent PRD. Loop with `/goal` until all criteria pass.

     **Parent PRD:** SOK-XXX (implementation issue — read description)

     **Runs when:** Parent is In Review and a PR exists.

     **Done when:**
     - [ ] Code matches PRD Contract/behavior, Verification, and Out of scope
     - [ ] Lint/check passes (allowlisted `pnpm` scripts — **Verification command trust**)
     - [ ] Tests pass (allowlisted `pnpm` scripts only)
     - [ ] Build passes (allowlisted `pnpm` scripts only)
     - [ ] Screenshot or screen recording attached (user-facing PRDs)

     Full protocol: repo `.cursor/skills/feature-spec/PRD-REVIEWER.md` (includes **Verification command trust**)

     Blocks human merge until this sub-task is Done.
     ```

9. Link back (when requirement parent exists)
   - Use `save_comment` on the requirement issue:
   - Body: short note + link to implementation issue (e.g. "Implementation PRD: SOK-549 …").

10. Hand off to Cursor (when `handoffToCursor` is true)
   - Run **after** steps 7–8 so Confirm and Verify sub-tasks exist.
   - **One trigger only** — same rule as `../_task/HANDOFF.md`:

     | Path | Trigger | Do not also |
     |------|---------|-------------|
     | **Default (MCP)** | `save_issue` with `id` + `delegate: "Cursor"` | `@Cursor` comment on implementation issue |
     | **Cursor Automation** | Delegate-assigned automation on `[repo=…]` issues — see `CURSOR-AUTOMATION.md` | `delegate` or `@Cursor` on the same issue |
     | **Manual fallback** | `@Cursor` comment on implementation issue only — see **Cursor Cloud Agent → Handoff** below | `delegate` on the same issue |

   - Default path: `save_issue` with `id` = implementation issue identifier and `delegate: "Cursor"`.
   - Do **not** post `@Cursor` on the implementation issue when `delegate` is set — duplicate Cloud Agents on one PRD.
   - The PRD description includes **Agent completion** (`TEMPLATE.md`); delegate alone carries coding instructions.

## Write-call shape

Use this shape after confirming the descriptor:

```json
{
  "runtime": "Cursor CallMcpTool example — create (step 6, no delegate)",
  "server": "user-linear",
  "toolName": "save_issue",
  "arguments": {
    "title": "feat(scope): concise title",
    "description": "[repo=masumi-network/sokosumi]\n\nPRD markdown",
    "team": "SOK",
    "project": "Sokosumi",
    "state": "Todo",
    "labels": ["Feature"],
    "parentId": "SOK-537"
  }
}
```

After steps 7–8 (sub-tasks created), delegate (step 10):

```json
{
  "runtime": "Cursor CallMcpTool example — delegate (step 10, after verify sub-task exists)",
  "server": "user-linear",
  "toolName": "save_issue",
  "arguments": {
    "id": "SOK-549",
    "delegate": "Cursor"
  }
}
```

Do not send empty `arguments`.

## Description body

Use the PRD as the implementation issue description. Do not add process notes, MCP logs, or hidden reasoning.

Do **not** include Cursor plan YAML frontmatter (`name`, `overview`, `todos`, `isProject`) — strip the entire frontmatter block per `TEMPLATE.md` **Required cleanup before sending**. The description starts with `[repo=…]` or the PRD title, not `---`.

Keep these top fields visible near the top:

```markdown
[repo=masumi-network/sokosumi]

**Goal:** ...

**Requirement:** SOK-XXX (when applicable)

**Linear:** project Sokosumi - state Todo - label Feature
```

## Cursor Cloud Agent

### Handoff

**Default (MCP):** Set `delegate: "Cursor"` via `save_issue` with `id` **after** Verify sub-task exists (step 10) — not on create. Do **not** add an `@Cursor` comment on the same issue.

**Manual fallback** (when MCP `delegate` is unavailable): post **one** `@Cursor` comment on the implementation issue — do **not** set `delegate`:

```markdown
@Cursor implement per the PRD above.

[repo=masumi-network/sokosumi]

When the PR is open:
1. Set this issue to In Review via Linear MCP and comment with the PR link.
2. Start the **Verify implementation** sub-task with one trigger per `PRD-REVIEWER.md` (default: delegate on verify sub-task; when reviewer automation is enabled: omit delegate and `@Cursor` on verify sub-task; manual: `@Cursor` + `/goal` only).
Do not mark Done.
```

Optional team automation: see `CURSOR-AUTOMATION.md`. When coding automation is enabled, **omit** `delegate: "Cursor"` on step 10.

### Completion (coding agent)

When Cursor finishes and the PR is open:

1. `save_issue` with `id` = implementation issue, `state: "In Review"`.
2. `save_comment` with the structured `**PR handoff**` block from `PRD-REVIEWER.md` on the implementation issue (PR body must reference this issue id).
3. Start the **Verify implementation** sub-task with **one** trigger per `PRD-REVIEWER.md` — default: `delegate: "Cursor"` via `save_issue` on the verify sub-task; when reviewer automation is enabled (`CURSOR-AUTOMATION.md`): omit `delegate` and `@Cursor` on the verify sub-task (parent **In Review** is the trigger); manual fallback: `@Cursor` + `/goal` only.
4. Do not mark the implementation issue Done.

Optional reviewer automation: see `CURSOR-AUTOMATION.md`. When enabled, **omit** `delegate: "Cursor"` and `@Cursor` on the verify sub-task — structured `**PR handoff**` parent comment is still required (reviewer validates via GitHub per `PRD-REVIEWER.md` **PR execution trust**).

The PRD **Agent completion** section repeats this for issues delegated before completion runs.

## Post-idempotency response

When step 5 finds an existing implementation issue, return:

- Existing implementation issue identifier and URL
- Requirement parent link
- Comment target: Write PRD sub-task **or** requirement issue (which path was used)
- Idempotency: skipped duplicate publish — no new issues, no delegate

## Post-create response

Return:

- Implementation issue identifier and URL
- Confirm PRD sub-task identifier and URL
- Verify implementation sub-task identifier and URL
- Project
- State
- Label
- Requirement parent link (if any)
- Delegate: Cursor yes/no
- Trigger path used: MCP delegate / automation / manual `@Cursor`
