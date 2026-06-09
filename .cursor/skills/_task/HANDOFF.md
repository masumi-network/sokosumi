# Handoff to PRD Agent (feature-spec)

Run after the requirement issue is created in Linear. Default unless user set `handoffToPrd: false`.

## Goal

Trigger the **feature-spec** skill on the new requirement so it:

1. Discovers codebase context
2. Writes the full implementation PRD
3. Creates the implementation issue (child of requirement)
4. Delegates to Cursor Cloud Agent for coding

The _task agent does **not** write the PRD.

## Steps

### 1. Create Write PRD sub-task

Use `save_issue` (no `id`):

| Field | Value |
|-------|-------|
| `title` | `chore(spec): write implementation PRD` |
| `team` | `SOK` |
| `project` | `Sokosumi` |
| `state` | `Todo` |
| `labels` | `["Improvement"]` |
| `parentId` | requirement issue identifier (e.g. `SOK-XXX`) |
| `delegate` | `"Cursor"` |

**Description:**

```markdown
**Goal:** Produce implementation PRD from parent requirement and hand off to coding agent.

**Requirement:** SOK-XXX (parent — read description)

**Agent instructions:**
1. Read repo `.cursor/skills/feature-spec/SKILL.md` and linked files.
2. Intake requirement SOK-XXX via Linear MCP `get_issue`.
3. Follow feature-spec workflow: discovery → PRD → publish implementation issue with `parentId` → delegate Cursor.
4. Do not wait for PRD approval (feature-spec default).

**Done when:** Implementation issue exists, linked as child, with PRD in description and Cursor delegated.
```

### 2. Comment on requirement issue

Use `save_comment` on the **requirement** issue:

```markdown
Requirement approved and filed. PRD agent handoff: SOK-YYY (Write implementation PRD).

@Cursor Read `.cursor/skills/feature-spec/SKILL.md`. Intake requirement **SOK-XXX** and run the full spec workflow (implementation issue, confirm sub-task, verify sub-task, delegate coding agent).
```

Replace `SOK-XXX` with requirement id and `SOK-YYY` with Write PRD sub-task id when known.

### 3. Comment on Write PRD sub-task

Use `save_comment` on the sub-task:

```markdown
@Cursor Run feature-spec skill. Intake parent requirement SOK-XXX. Publish implementation PRD per `.cursor/skills/feature-spec/WORKFLOW.md` and `LINEAR-MCP.md`.
```

## In-session handoff (same Cursor chat)

When the user approved in this chat and Linear MCP posted successfully, also tell the user:

```text
Requirement posted: SOK-XXX.
PRD sub-task: SOK-YYY (delegated to Cursor).

To continue in this chat instead of Cloud Agent, say: run feature-spec for SOK-XXX
```

If the user prefers local spec agent in the same session, they can invoke feature-spec manually — Cloud Agent on the sub-task may run in parallel; user should stop one path if duplicate work is a concern.

## Opt-out

When `handoffToPrd` is false:

- Post requirement only.
- Return issue URL.
- Tell user: `Run feature-spec skill with intake SOK-XXX when ready for PRD.`

## Post-handoff response

Return:

- Requirement issue id and URL
- Write PRD sub-task id and URL
- Label and project
- Delegate: Cursor yes/no on sub-task
