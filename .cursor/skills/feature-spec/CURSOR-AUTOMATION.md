# Cursor Automation (optional)

Use when you want **every new implementation issue** to start a Cloud Agent without manual assign.

This is optional. The spec agent can also delegate in the same MCP call via `delegate: "Cursor"` on `save_issue`.

## Recommended setup

Create one Cursor Automation in the Agents Window:

| Field | Value |
|-------|--------|
| Name | SOK implementation → Cloud Agent |
| Trigger | Linear — Issue created |
| Filter | Team: Sokosumi (SOK). Optional: label is one of Feature, Improvement, Bug |
| Tools | GitHub, Linear (as needed) |
| Instructions | Read the issue description as the implementation PRD. Follow verification and out-of-scope sections. Open a PR when done. Repo: `[repo=masumi-network/sokosumi]` unless the issue specifies otherwise. |

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
- Bot-created issues (Slack, MCP) should use org-level Linear connection; see Cursor forum updates on automation auth fallback.
- First `@Cursor` mention may prompt account linking.

## Manual fallback

On any implementation issue:

1. Assign **Cursor** as delegate, or
2. Comment: `@Cursor implement per the PRD above. [repo=masumi-network/sokosumi]`
