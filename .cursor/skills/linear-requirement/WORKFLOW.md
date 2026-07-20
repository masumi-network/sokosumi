# Requirement → Linear Issue

One skill. One Linear issue. Approval gate before any write.

```mermaid
flowchart LR
  user["User describes\nfeature / bug / improvement"] --> intake["linear-requirement"]
  intake --> draft["Draft requirement\n(chat only)"]
  draft --> approve{"User\napproves?"}
  approve -->|no| intake
  approve -->|yes| issue["Single Linear issue\n## Requirement"]
```

## Agent role

| Agent | Skill | Output | Approval gate |
|-------|-------|--------|---------------|
| **Requirement** | `linear-requirement` | Linear issue with `## Requirement` | **Yes** — user must approve draft |

## Workflow

1. **Intake** — plain-language description or rough Linear issue.
2. **Light discovery** — sharpen problem, goal, scope.
3. **Draft** — `REQUIREMENT-TEMPLATE.md` in chat only.
4. **Wait for approval** — do not touch Linear.
5. **Publish** — create issue per `LINEAR-MCP.md` (all defaults including `project: sokosumi-6357694ddd23`), then post-create verify.
6. **Stop** — return issue URL. Do not set `delegate` or add extra description sections.

## What belongs on the issue at create time

- `## Requirement` — problem, goal, decisions, out of scope

## What not to do

- Do not post to Linear before user approval.
- Do not write `## Spec` or other non-requirement sections on create.
- Do not set Linear `delegate` or `@Cursor` from this skill.
