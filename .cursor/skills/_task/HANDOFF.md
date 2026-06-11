# Handoff to PRD Agent (feature-spec)

Run after the requirement issue is created in Linear. Default unless user set `handoffToPrd: false`.

## Goal

Trigger the **feature-spec** skill on the new requirement so it:

1. Discovers codebase context
2. Writes the full implementation PRD
3. Creates the implementation issue (child of requirement)
4. Creates **Confirm PRD** and **Verify implementation** sub-tasks under the implementation issue
5. Delegates to Cursor Cloud Agent for coding — **after** both sub-tasks exist

The _task agent does **not** write the PRD.

## One trigger rule

Start Cloud Agent for feature-spec **once** on the Write PRD sub-task.

| Path | Trigger | Do not also |
|------|---------|-------------|
| **Default (MCP)** | `delegate: "Cursor"` on Write PRD `save_issue` | `@Cursor` on requirement or sub-task |
| **Cursor Automation** | Issue-created automation on title `chore(spec): write implementation PRD` | `delegate` or `@Cursor` — see `../feature-spec/CURSOR-AUTOMATION.md` |
| **Manual fallback** | `@Cursor` comment on Write PRD sub-task only | `delegate` on the same sub-task |

Each extra trigger (delegate + comment, requirement + sub-task, MCP + automation) can start a separate agent and publish duplicate implementation issues for the same requirement.

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
| `delegate` | `"Cursor"` — **omit** when the team uses Write PRD Cursor Automation instead |

**Description:**

```markdown
**Goal:** Produce implementation PRD from parent requirement and hand off to coding agent.

**Requirement:** SOK-XXX (parent — read description)

**Agent instructions:**
1. Read repo `.cursor/skills/feature-spec/SKILL.md` and linked files (especially `LINEAR-MCP.md`).
2. Intake requirement SOK-XXX via Linear MCP `get_issue`.
3. Follow feature-spec workflow per `LINEAR-MCP.md`: discovery → PRD → publish implementation issue with `parentId` (no `delegate` on create) → create Confirm PRD sub-task → create Verify implementation sub-task → delegate Cursor on implementation issue.
4. Do not wait for PRD approval (feature-spec default).
5. If an implementation issue already exists under the requirement (description contains `[repo=…]`), stop — do not publish a second PRD.

**Done when:** Implementation issue exists (child of requirement, PRD in description), Confirm PRD and Verify implementation sub-tasks exist under it, and Cursor is delegated on the implementation issue.
```

### 2. Comment on requirement issue (informational only)

Use `save_comment` on the **requirement** issue. **Do not** mention `@Cursor` — that can start Cloud Agent on the requirement and publish a duplicate implementation PRD.

```markdown
Requirement approved and filed. PRD agent handoff: SOK-YYY (Write implementation PRD).
```

Replace `SOK-YYY` with Write PRD sub-task id when known.

### 3. Manual fallback only (no `delegate` on step 1)

When `delegate: "Cursor"` is unavailable or the team does not use automation, post **one** `@Cursor` comment on the Write PRD sub-task — and do **not** set `delegate` on step 1:

```markdown
@Cursor Run feature-spec skill. Intake parent requirement SOK-XXX. Publish implementation PRD per `.cursor/skills/feature-spec/WORKFLOW.md` and `LINEAR-MCP.md` — create Confirm PRD and Verify implementation sub-tasks before delegating Cursor on the implementation issue. If an implementation issue already exists under the requirement, stop.
```

Replace `SOK-XXX` with requirement id.

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
- Trigger path used: MCP delegate / automation / manual `@Cursor`
