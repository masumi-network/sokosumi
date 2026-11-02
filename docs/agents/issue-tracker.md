# Issue tracker: Sokosumi Tasks

Issues, specs, and PRDs for this repo live as **Sokosumi Tasks** (not Linear). A Task's `description` is the spec. Short identifiers look like `SOK-12` or `SOKD-109` (`task.identifier`); every `tasks` command also accepts the Task UUID.

**Load the skill first.** [`.agents/skills/sokosumi/`](../../.agents/skills/sokosumi/) owns CLI install, auth, Workspace selection, and the "Track work as Tasks" recipes. This file is the repo's tracker map for skills that say "issue tracker" (`/code-review`, `/to-spec`, `/to-tickets`, `/triage`, `/wayfinder`, `/implement`).

## CLI and auth

Prefer the built CLI from this checkout when reviewing or implementing against live Tasks:

```bash
pnpm build --filter=@masumi_network/sokosumi --cache=local:w
node apps/cli/dist/bin/sokosumi.js --help
```

Configure the host's command tool with that path (or an installed `sokosumi` on `PATH`). Prefer `--preprod` for engineering Task reads and writes. Mainnet Task writes need an unambiguous operator `yes` first (see the skill).

Authenticate with a user API key or OAuth. `SOKOSUMI_API_KEY` takes precedence over `SOKOSUMI_AUTH_TOKEN`; both override saved OAuth credentials. Never print keys or tokens. If auth is missing, stop and ask the operator to set `SOKOSUMI_API_KEY` (cloud secrets) or run `sokosumi auth login` — do **not** fall back to Linear or invent the spec from a PR body when a Task id is known.

Organization context: pass `--organization-slug` on every organization Task call, or set `SOKOSUMI_ORGANIZATION_SLUG`. Discover memberships with `sokosumi --preprod workspaces list --json` and use the returned slug. Ask only when more than one Workspace fits.

## Conventions

- **Spec source:** `task.description` from `tasks get`. Long specs were written with `--description-file` while the Task was `DRAFT` or `READY`.
- **Link a PR only from the Task it implements.** Put the PR URL in a `tasks comment`. Parent / feature Tasks name merged docs by path (`GLOSSARY.md`, `docs/adr/…`).
- **One assignee:** a person (`--assignee-user-id` from `auth whoami`) or a Coworker (`--coworker-id`). Not both.
- **Links:** `tasks link` / `relink` / `unlink` with `--relation` (`child`, `parent`, `blocked_by`, `blocks`, `related`, `duplicate`). Web shows a `child` link's peer as the parent.
- **Progress:** one `tasks comment --status` per transition (`RUNNING`, `AWAITING_EXTERNAL`, `COMPLETED`, `CANCELED`), with the PR link or blocker in the comment body.

## Team Task statuses

`DRAFT` → `READY` → `RUNNING` → (`AWAITING_EXTERNAL`) → `COMPLETED`, plus `CANCELED`. Triage-role mapping lives in [`triage-labels.md`](./triage-labels.md).

Priority on create/update: `LOW` | `MEDIUM` | `HIGH` | `URGENT` (CLI `--priority`). Default for new work is `MEDIUM`.

## Branch naming (repo rule)

Branches for a Task MUST start with the lowercased `task.identifier` followed by a short kebab-case description — for `SOKD-109`, `sokd-109-short-description`. Prefer the identifier from `tasks get … --json` (`task.identifier`). Tasks without a project have `identifier: null`; use the UUID only in comments, and ask for a project before branching.

## When a skill says "publish to the issue tracker"

Create a Sokosumi Task in the intended organization Workspace (prefer `--preprod`):

```bash
sokosumi --preprod tasks create \
  --organization-slug WORKSPACE_SLUG \
  --name "Title" \
  --description-file ./spec.md \
  --priority MEDIUM \
  --project-id PROJECT_ID \
  --status READY \
  --json
```

`--project-id` comes from `projectId` on any Task already in that project (`tasks get SOK-1 --json`). Without a project the Task has no short identifier. Confirm the brief and write authorization before creating. Do not invent Tasks during implement work unless the user explicitly asked to file one.

## When a skill says "fetch the relevant ticket"

```bash
sokosumi --preprod tasks get TASK_ID --organization-slug WORKSPACE_SLUG --json
```

`TASK_ID` may be the short identifier (`SOKD-109`) or the UUID. The Spec axis uses `task.name` + `task.description` (and `tasks links` / `tasks events` when the skill needs relations or history). If auth fails, stop and request credentials — do not substitute Linear MCP or a PR body for a known Task id.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single Sokosumi Task; its **child** tickets are Tasks linked with `--relation child`.

- **Map:** create a Task whose description holds Notes / Decisions-so-far / Fog. Put `wayfinder:map` in the name or the first line of the description so agents can find it (`tasks list --search "wayfinder:map"`).
- **Child ticket:** `tasks create` then `tasks link CHILD --relation child --to MAP`. Once claimed, assign with `--assignee-user-id`.
- **Blocking:** `tasks link TICKET --relation blocked_by --to BLOCKER`. A ticket is unblocked when every blocker is `COMPLETED` or `CANCELED`.
- **Frontier query:** `tasks links MAP --json` — the map's children. Drop any with an assignee or an open `blocked_by`. First in link order wins.
- **Claim:** `tasks update TICKET --assignee-user-id USER_ID`, the session's first write.
- **Resolve:** `tasks comment TICKET --status COMPLETED --comment "…"`, then append a context pointer (gist + Task id) to the map's Decisions-so-far via `tasks update MAP --description-file …`.
