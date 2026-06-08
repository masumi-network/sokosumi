# Cursor Automation (optional)

Use when you want **every new implementation issue** to start a Cloud Agent without manual assign.

This is optional. The spec agent can also delegate in the same MCP call via `delegate: "Cursor"` on `save_issue`.

## Lifecycle

```mermaid
flowchart LR
  todo["Todo\n(PRD published)"] --> progress["In Progress\n(Cursor working)"]
  progress --> review["In Review\n(PR opened)"]
  review --> done["Done\n(after human merge)"]
```

| State | Who sets it | When |
|-------|-------------|------|
| `Todo` | Spec agent | Implementation issue created |
| `In Progress` | Cursor (optional) | Agent starts work |
| `In Review` | **Cursor (required)** | PR opened — see completion protocol below |
| `Done` | Human | After PR review and merge |

The implementation issue (PRD task) must land in **In Review** when Cursor finishes — not Done.

## Completion protocol (Cursor Cloud Agent)

Every coding run must end with this, whether triggered by delegate, `@Cursor`, or automation:

1. Open PR with verification from the PRD.
2. Linear MCP `save_issue` on the **implementation issue** (the delegated issue):

   ```json
   {
     "id": "SOK-XXX",
     "state": "In Review"
   }
   ```

3. `save_comment` on the same issue with PR URL and short summary.
4. Do **not** mark Done or close the confirm PRD sub-task.

The PRD template includes an **Agent completion** section so delegated issues carry these instructions in the description.

## Recommended automation setup

Create one Cursor Automation in the Agents Window:

| Field | Value |
|-------|--------|
| Name | SOK implementation → Cloud Agent |
| Trigger | Linear — Issue created |
| Filter | Team: Sokosumi (SOK). Optional: label is one of Feature, Improvement, Bug |
| Tools | GitHub, Linear |
| Instructions | Read the issue description as the implementation PRD. Follow verification and out-of-scope sections. Open a PR when done. Repo: `[repo=masumi-network/sokosumi]` unless the issue specifies otherwise. **When the PR is open:** use Linear MCP to set this issue to `In Review`, comment with the PR link, and do not mark Done. |

### Optional: status-changed automation

If you want a separate automation when Cursor updates Linear:

| Field | Value |
|-------|--------|
| Trigger | Linear — Status changed → `In Review` |
| Filter | Team SOK, delegate is Cursor |
| Action | Slack notify / assign human reviewer (team choice) |

This is optional. The required behavior is Cursor setting **In Review** on completion, not a follow-up automation.

## Linear triage rule (alternative)

In Linear project settings → Triage rules:

1. When issue created in SOK with label `Feature` or `Improvement`
2. And description contains `**Linear:**` (implementation PRD marker from spec agent)
3. Assign delegate **Cursor**

Note: Linear triage may require a human assignee on some plans. MCP `delegate: "Cursor"` on create avoids that.

## Repo labels in Linear

So Cloud Agent picks the repo without repeating `[repo=...]` every time:

1. Linear Settings → Labels → New group → name exactly `repo`
2. Add child label `masumi-network/sokosumi`
3. Spec agent adds that label on implementation issues (optional)

## Auth notes

- Cursor admin must connect Linear in [Cursor integrations](https://cursor.com/docs/integrations/linear).
- Cloud Agent needs **Linear MCP** enabled to set `In Review` on completion.
- Bot-created issues (Slack, MCP) should use org-level Linear connection; see Cursor forum updates on automation auth fallback.
- First `@Cursor` mention may prompt account linking.

## Manual fallback

On any implementation issue:

1. Assign **Cursor** as delegate, or
2. Comment:

   ```markdown
   @Cursor implement per the PRD above.

   [repo=masumi-network/sokosumi]

   When the PR is open: set this issue to In Review via Linear MCP and comment with the PR link. Do not mark Done.
   ```
