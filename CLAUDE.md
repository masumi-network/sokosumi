# Sokosumi

Project guidance for AI agents lives in `AGENTS.md`, imported below so it
applies across Claude Code, Cursor, and other AGENTS.md-aware tools from a
single source of truth.

@AGENTS.md

## Critical rules — read before opening a PR

> These are repeated inline (not only via `@AGENTS.md`) because some tools —
> including the Claude Code cloud "Create PR" flow that auto-generates the PR
> title — read `CLAUDE.md` directly and may not expand the import. They apply
> to **every** PR, including AI/agent-created ones.

### PR title MUST be a Conventional Commit

`type(optional-scope): description` — lowercase `type`, no trailing period.
Enforced by the `Validate PR Title` CI check; a non-conforming title fails the
build. Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`,
`test`, `build`, `ci`, `chore`, `revert`.

- **Set the PR title to the primary commit's subject line verbatim** — it is
  already a Conventional Commit. Do NOT invent a new descriptive sentence or
  rely on a generated summary.

| ✅ Valid | ❌ Invalid |
| --- | --- |
| `feat(core): add agent rating read endpoints for web` | `Add endpoint for fetching authenticated user's agent review` |
| `fix(admin): remove duplicate Organization header` | `Remove duplicate Organization header` |

### Branch names for Linear issues

The branch name MUST start with the issue identifier (lowercased), followed by
a short kebab-case description — e.g. for `SOK-555`, name the branch
`sok-555-short-description`. Prefer the `gitBranchName` Linear provides for the
issue when available.

## Agent skills

### Issue tracker

Issues live in Linear (team "Sokosumi", key `SOK`), accessed via the Linear MCP
tools. See `docs/agents/issue-tracker.md`.

### Triage labels

Hybrid mapping: native Linear statuses for needs-triage (Triage) and wontfix
(Canceled); labels `needs-info` / `ready-for-agent` / `ready-for-human`. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily).
See `docs/agents/domain.md`.

