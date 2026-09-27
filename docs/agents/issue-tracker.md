# Issue tracker: Linear

Issues and PRDs for this repo live in **Linear**, team **Sokosumi** (issue key `SOK`).

**CLI first.** When `linear` is on PATH, use it for all operations and ignore Linear MCP (`linear__*`). Command catalog: [`.agents/skills/linear-cli/`](../../.agents/skills/linear-cli/).

**MCP fallback.** If `command -v linear` fails, use Linear MCP. Inspect live schemas. Requirement writes: [`skills/linear-requirement/LINEAR-MCP.md`](../../skills/linear-requirement/LINEAR-MCP.md). Do not use MCP when the CLI is present. Do not use browser, curl, or Linear REST.

Repo config: [`.linear.toml`](../../.linear.toml) (`workspace = "masumi"`, `team_id = "SOK"`). CLI auth: `LINEAR_API_KEY` or `linear auth login`. Never print the API key. `linear api` is the GraphQL fallback when a typed CLI command does not expose a field.

## Conventions

- **Create an issue**: `linear issue create --no-interactive --no-use-default-template --team SOK --project sokosumi-6357694ddd23 --title "..." --description-file <path> --state Triage --priority 3 --label Feature`. Apply domain labels (`Bug`, `Feature`, `Improvement`, `Core`, `App`, …) where obvious. Stdout is the issue URL; parse `SOK-XXX` from it.
- **Read an issue**: `linear issue view SOK-555 --json --no-pager --no-download`. Comments are included. Branch name is `branchName`.
- **List issues**: `linear issue query --team SOK --search "..." --limit 10 --json --no-pager`. `linear issue list` / `mine` is **your** unstarted issues only — not a team list.
- **Comment on an issue**: `linear issue comment add SOK-555 --body-file <path>`
- **List comments**: `linear issue comment list SOK-555 --json`
- **Update status**: `linear issue update SOK-555 --state "In Progress"`
- **Update labels**: `--add-label` / `--remove-label`. `--label` replaces the entire set.
- **Blocking**: `linear issue relation add SOK-123 blocked-by SOK-100`
- **Create a team label**: `linear label create --team SOK --name needs-info`

Pass `--team SOK` and `--project sokosumi-6357694ddd23`. Do not pass `Sokosumi` as the project name (ambiguous; wrong spelling of **Sōkosumi**).

## Team workflow states

`Triage` → `Backlog` → `Todo` → `In Progress` → `In Review` → `Done`, plus `Canceled` and `Duplicate`. Triage-role mapping lives in `docs/agents/triage-labels.md`.

Priority: `0` No priority, `1` Urgent, `2` High, `3` Medium, `4` Low. Create default is `3` Medium. CLI `--priority` is `1`–`4`; MCP also accepts `0`.

## Branch naming (repo rule)

Branches for a Linear issue MUST start with the lowercased issue identifier followed by a short kebab-case description — for `SOK-555`, `sok-555-short-description`. Prefer `branchName` from `linear issue view SOK-555 --json` when available.

## When a skill says "publish to the issue tracker"

Create a Linear issue in the Sokosumi team (`--team SOK`).

## When a skill says "fetch the relevant ticket"

`linear issue view <id> --json --no-pager --no-download`. If `linear` is not on PATH, `get_issue` plus `list_comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single Linear issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `linear issue create --no-interactive --no-use-default-template --team SOK --project sokosumi-6357694ddd23 --title "..." --description-file <path> --label wayfinder:map`. Create the team label first if it is missing (`linear label create --team SOK --name wayfinder:map`).
- **Child ticket**: `linear issue create --no-interactive --no-use-default-template --team SOK --project sokosumi-6357694ddd23 --parent SOK-XXX --title "..." --description-file <path> --label wayfinder:<type>` (`research` / `prototype` / `grilling` / `task`). Once claimed, assign to the driving dev.
- **Blocking**: Linear's **native relation**, the canonical, UI-visible representation. `linear issue relation add SOK-123 blocked-by SOK-100`. A ticket is unblocked when every blocker is closed.
- **Frontier query**: `linear issue view <map> --json --no-pager --no-download` — the map's **children**. Drop any with an assignee or an open `blocked-by` (`linear issue relation list <child> --json`). `issue query` has no `--parent` filter. First in map order wins.
- **Claim**: `linear issue update SOK-555 --assignee self`, the session's first write.
- **Resolve**: `linear issue comment add SOK-555 --body-file <path>`, then `linear issue update SOK-555 --state Done`, then append a context pointer (gist + link) to the map's Decisions-so-far.
