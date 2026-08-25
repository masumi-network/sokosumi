# Linear CLI — Requirement Issues

Run **only after** the user approves the draft in chat.

Creates or updates **one** Linear issue with `## Requirement`. No child issues.

Only touch the fields documented here — no other Linear side effects.

Use `linear` when it is on PATH. CLI recipes and flags: [`.agents/skills/linear-cli/`](../../.agents/skills/linear-cli/). This file is Sokosumi requirement publish rules (team, project, approval, defaults). Pass `--no-interactive` on create. Prefer `--description-file` for markdown. Never print `LINEAR_API_KEY`. If `command -v linear` fails, stop using this file and follow `LINEAR-MCP.md`.

## Defaults

```typescript
const LINEAR_TEAM = "SOK";
// Marketplace project — pass slug/ID, not "Sokosumi" (ambiguous; wrong spelling).
const LINEAR_PROJECT = "sokosumi-6357694ddd23"; // display name: Sōkosumi
const LINEAR_PROJECT_ID = "a51c9d61-b1a4-457e-a382-1277e1f7be4a";
const LINEAR_STATE = "Triage";
const LINEAR_PRIORITY = 3; // Medium — 1=Urgent, 2=High, 3=Medium, 4=Low
const LINEAR_ASSIGNEE = null; // omit --assignee on create unless user overrides
const LINEAR_LABELS = ["Feature", "Bug", "Improvement"] as const;
```

Also in repo: `.linear.toml` → `project_id = "sokosumi-6357694ddd23"`.

## Required on create (never omit)

Every `linear issue create` must include **all** of:

| Flag | Default |
|------|---------|
| `--title` | user-approved **product** title (no `feat:` / `fix:` prefix) |
| `--description-file` | approved requirement (`## Requirement`) |
| `--team` | `SOK` |
| `--project` | `sokosumi-6357694ddd23` (Sōkosumi marketplace) |
| `--state` | `Triage` |
| `--priority` | `3` (Medium) |
| `--label` | exactly one of `Feature`, `Bug`, or `Improvement` |
| `--no-interactive` | always |
| `--no-use-default-template` | always |

**Do not pass `--assignee` on create** unless the user explicitly asked for an assignee during intake.

Override other fields only when the user explicitly passed a different value during intake.

**Never omit `--project`.** If the user did not name a project, always pass `--project sokosumi-6357694ddd23`.

**Do not pass `--project Sokosumi`.** Linear’s marketplace project is **Sōkosumi** (macron on the first o). The plain string `Sokosumi` does not resolve — the workspace also has Sokosumi Social Media, Sokosumi Task Board, etc. Use the slug.

Do **not** set `--parent` unless user asked to file under an epic/parent.

## Update existing issue

When publish target is `update:SOK-XXX` and the user approved the draft:

1. `linear issue view SOK-XXX --json --no-pager --no-download` immediately before write — `--description` / `--description-file` **replaces** the entire description.
2. Start from the full current description. Replace or insert `## Requirement` with the approved body. Preserve any other sections already on the issue.
3. Write the merged body to a file, then `linear issue update SOK-XXX --description-file <path>`. Also set `--title` when the approved draft changed it.
4. `--label` **replaces the full set**. Prefer `--add-label` / `--remove-label` so other labels stay. If the type label (`Feature` / `Bug` / `Improvement`) changed, `--remove-label` the old type and `--add-label` the new one. Omit label flags when the type label is unchanged.
5. Set `--priority`, `--assignee`, or `--project` **only** when the user explicitly overrode them in the approved draft.
6. **Never set `--state` on update** unless the user explicitly asked to change state. Do **not** reset `In Progress` / `In Review` / etc. to `Triage` because that is the create default.
7. **Do not** create a second issue.

## Hard rules

- Use the `linear` CLI on this path. No browser automation, curl, or Linear REST.
- `linear api` is GraphQL fallback for fields a typed command does not expose — not a substitute for create/update.
- If `linear` is missing, switch to `LINEAR-MCP.md`. Do not use MCP while `linear` is on PATH.
- **Never create or update before user approval.**
- **Never create without `--project`** — same rule as `--state` and `--priority` on create.
- **Never pass `--assignee` on create** unless the user explicitly requested one.

## CLI health check

Run **before** any Linear write (after user approval):

1. `command -v linear`. If it fails, stop this file and follow `LINEAR-MCP.md`.
2. `linear team list` (proves auth; `.linear.toml` + `LINEAR_API_KEY` or `linear auth login`).
3. If `linear` is present but `linear team list` fails, stop and tell the user to authenticate (`LINEAR_API_KEY` or `linear auth login`). Do not fall back to MCP when the binary is installed.

## Resolution order (create only)

1. Team → `--team SOK`
2. Project → `--project sokosumi-6357694ddd23` / Sōkosumi (or user override)
3. State → `--state Triage`
4. Priority → `--priority 3` (Medium) unless user override
5. Assignee → omit unless user override
6. Label → `--label` exact match from draft
7. Create via `linear issue create --no-interactive --no-use-default-template` with the full required flag set above (no `--assignee` unless overridden)

Stdout is the issue URL (`https://linear.app/masumi/issue/SOK-XXX/...`). Parse the identifier from it.

## Post-write verify

Immediately after create or update:

1. `linear issue view <identifier> --json --no-pager --no-download`
2. **Create only:** if any create default is missing or wrong and the user did not override it, patch with `linear issue update`:
   - `project.name` not `Sōkosumi` (or `project` id not `a51c9d61-b1a4-457e-a382-1277e1f7be4a`) → `--project sokosumi-6357694ddd23`
   - assignee set and user did **not** request one → `--unassign`
   - `state.name` not `Triage` → `--state Triage`
   - priority not `3` (Medium) → `--priority 3`
3. **Update:** do **not** patch state/assignee/priority/project back to create defaults. Only confirm `## Requirement` (and approved title/labels) landed. If labels were sent, confirm non-type labels (e.g. `ready-for-agent`, `needs-info`) are still present.
4. Return the issue id and URL.

## Write-call arguments (create)

Write the approved body to a file, then:

```bash
linear issue create \
  --no-interactive \
  --no-use-default-template \
  --team SOK \
  --project sokosumi-6357694ddd23 \
  --state Triage \
  --priority 3 \
  --label Feature \
  --title "History view for past agent jobs" \
  --description-file /tmp/sok-requirement.md
```

## Write-call arguments (update)

```bash
linear issue update SOK-XXX \
  --title "History view for past agent jobs" \
  --description-file /tmp/sok-requirement.md
```

Omit `--state` on update unless the user explicitly asked to change it. Include `--add-label` / `--remove-label` only when the type label changed. Include `--priority` / `--assignee` / `--project` only when the approved draft overrode them.

## Description body

Use the approved requirement from `REQUIREMENT-TEMPLATE.md`. No CLI logs or agent reasoning.

Do **not** add chat-only draft lines, `[repo=…]`, `## Spec`, or verification commands on create/update.

## Post-write

1. Return issue identifier and URL.
2. Stop. Do not start `/to-spec`, `/implement`, or any other engineering flow in this session.
