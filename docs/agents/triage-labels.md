# Triage Labels

The skills speak in terms of five canonical triage roles. This repo tracks work as **Sokosumi Tasks**, which express readiness through Task status (and comments), not Linear labels.

| Canonical role    | Sokosumi Task mapping                        | Meaning                                  |
| ----------------- | -------------------------------------------- | ---------------------------------------- |
| `needs-triage`    | status **DRAFT**                             | Maintainer needs to evaluate this Task   |
| `needs-info`      | status **AWAITING_EXTERNAL** + comment       | Waiting on reporter for more information |
| `ready-for-agent` | status **READY**                             | Fully specified, ready for an AFK agent  |
| `ready-for-human` | status **READY** + comment `ready-for-human` | Requires human implementation            |
| `wontfix`         | status **CANCELED**                          | Will not be actioned                     |

Rules:

- When a skill says "apply the needs-triage label", set the Task to **DRAFT** (`tasks update … --status DRAFT` or create as `DRAFT`).
- When a skill says "apply wontfix", set the Task to **CANCELED** (optionally with a closing `tasks comment`).
- Applying `ready-for-agent` or `ready-for-human` moves the Task to **READY** — the comment (when used) says _who_ should pick it up; the status says it is ready.
- For `needs-info`, move to **AWAITING_EXTERNAL** and leave the clarifying question in the comment body.
- CLI recipes: [`.agents/skills/sokosumi/`](../../.agents/skills/sokosumi/) and [`issue-tracker.md`](./issue-tracker.md).
