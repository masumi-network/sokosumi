# Triage Labels

The skills speak in terms of five canonical triage roles. This repo tracks issues in Linear (team Sokosumi), which expresses two of the roles as native workflow states; the rest are labels.

| Canonical role    | Linear mapping            | Meaning                                  |
| ----------------- | ------------------------- | ---------------------------------------- |
| `needs-triage`    | status **Triage**         | Maintainer needs to evaluate this issue  |
| `needs-info`      | label `needs-info`        | Waiting on reporter for more information |
| `ready-for-agent` | label `ready-for-agent`   | Fully specified, ready for an AFK agent  |
| `ready-for-human` | label `ready-for-human`   | Requires human implementation            |
| `wontfix`         | status **Canceled**       | Will not be actioned                     |

Rules:

- When a skill says "apply the needs-triage label", move the issue to the **Triage** status instead.
- When a skill says "apply wontfix", move the issue to **Canceled** (optionally with a closing comment) instead.
- Applying `ready-for-agent` or `ready-for-human` also moves the issue from Triage to **Todo** — the label says *who* should pick it up; the status says it is ready.
- The three labels (`needs-info`, `ready-for-agent`, `ready-for-human`) do not exist in the Sokosumi team yet — create them on first use (`linear label create --team SOK --name needs-info`).
