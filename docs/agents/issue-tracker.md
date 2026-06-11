# Issue tracker: Linear

Issues and PRDs for this repo live in **Linear**, team **Sokosumi** (issue key `SOK`). Use the Linear MCP tools (`mcp__claude_ai_Linear__*`) for all operations — there is no CLI.

## Conventions

- **Create an issue**: `save_issue` with `team: "Sokosumi"`, a title, and a markdown description. Apply domain labels (Bug, Feature, Improvement, Core, App, …) where obvious.
- **Read an issue**: `get_issue` by identifier (e.g. `SOK-555`), plus `list_comments` for the discussion.
- **List issues**: `list_issues` filtered by team, state, label, or assignee.
- **Comment on an issue**: `save_comment`.
- **Update status / labels**: `save_issue` with the issue id and the new state or labels.

## Team workflow states

`Triage` → `Backlog` → `Todo` → `In Progress` → `In Review` → `Done`, plus `Canceled` and `Duplicate`. Triage-role mapping lives in `docs/agents/triage-labels.md`.

## Branch naming (repo rule)

Branches for a Linear issue MUST start with the lowercased issue identifier followed by a short kebab-case description — for `SOK-555`, `sok-555-short-description`. Prefer the `gitBranchName` Linear provides for the issue when available.

## When a skill says "publish to the issue tracker"

Create a Linear issue in the Sokosumi team.

## When a skill says "fetch the relevant ticket"

`get_issue` for the identifier, then `list_comments` for context.
