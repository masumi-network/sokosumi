# Skill and domain routing

Required when the matching trigger in [AGENTS.md](../../AGENTS.md) applies.
Commands and backticked paths are relative to the repository root unless stated otherwise.

## Agent skills

First-party sources in `skills/` are only `linear-requirement` and `translations`. `.agents/skills/<name>` is a symlink to that tree for those two (`.claude/skills` already symlinks to `.agents`). Other named flows live under `.agents/skills/`. For app work, resolve `apps/<app>/.agents/skills/<name>/` first, then `.agents/skills/<name>/`, then `skills/<name>/`. Read an app skill by path when it is absent from a root-started session’s catalog. Third-party installs live only under `.agents/skills/` — at the repo root for shared skills, or under `apps/<app>/.agents/skills/` (with `apps/<app>/skills-lock.json` beside it) when the skill is scoped to one app, mirroring `apps/core/.agents/skills/`. Web UI implement/review: follow [`apps/web/AGENTS.md`](../../apps/web/AGENTS.md) and the Jakub skills under [`apps/web/.agents/skills/better-ui/`](../../apps/web/.agents/skills/better-ui/) (and siblings `better-typography`, `better-colors`, `better-accessibility`, `better-layout`, `better-writing`, `better-interface`, `interface-review`, `explain-interface`, `variant`, `break`).

### Manage installations with the skills CLI

Use `npx skills` to install, remove, update, or change the scope of managed skills.
Run it from the owning directory: the repository root for shared skills,
`apps/web` for Web skills, or the corresponding app/package directory. Let the CLI
write skill files, agent links, and `skills-lock.json`; do not move managed skill
folders or edit their lock entries by hand. For a scope change, install through
the CLI in the destination, verify its listing, then remove the old registration
through the CLI in the source scope.

For the Web UI skills, run from `apps/web`:

```bash
npx skills add jakubkrehel/skills --skill better-ui better-typography better-colors better-accessibility better-layout better-writing better-interface interface-review explain-interface variant break --agent codex claude-code --yes
npx skills list
```

Use `npx skills update --project` from that same directory to manage updates.

### Next.js (apps/web only)

App Router skills live under `apps/web/.agents/skills/`. They register only once a file under `apps/web/` is open, so name them yourself rather than waiting for them to appear. `next-partial-prefetching-adoption` owns the instant-navigation sweep — the `instant` route export, `instant-shell-url-data`, `blocking-prerender-*`. `next-cache-components`, `-adoption` and `-optimizer` own `cacheComponents`, `use cache` and static shells. `next-dev-loop` verifies a change against a running `next dev`; reach for it before hand-rolling curl against the dev log, which names the route but not the cause. Also `next-best-practices`, `next-upgrade`, `better-auth-best-practices`, `vercel-react-best-practices`, `vercel-composition-patterns`, `vercel-react-view-transitions`, `web-design-guidelines`.

### Evlog (Core only)

Core HTTP logging uses evlog. Conventions live in [`apps/core/AGENTS.md`](../../apps/core/AGENTS.md) (the `<!-- evlog:start -->` block plus Sokosumi constraints). Skills are under `apps/core/.agents/skills/` (`review-logging-patterns`, `build-audit-logs`, `analyze-logs`). Do not add `evlog/next` to Web. Do not run `evlog agents` at the repo root.

### Apple (apps/apple only)

Native SwiftUI work uses `swiftui-expert-skill` (from `avdlee/swiftui-agent-skill`), installed app-scoped under `apps/apple/.agents/skills/` — never the repo root. Load it when writing, reviewing, or refactoring SwiftUI for macOS/iOS. Install or update with `apps/apple` as cwd: `npx skills add https://github.com/avdlee/swiftui-agent-skill -s swiftui-expert-skill -y`. The repo's second skill, `update-swiftui-apis`, is intentionally not installed (skill maintenance; requires Sosumi MCP).

### Ask Matt

Main engineering flow. See [`.agents/skills/ask-matt/`](../../.agents/skills/ask-matt/) when choosing how to grill, spec, ticket, or implement.

### Caveman

When the caveman skill is present, follow it for all replies. Off: "stop caveman" / "normal mode". See [`.agents/skills/caveman/`](../../.agents/skills/caveman/).

### Ponytail

Always-on for coding work. Default **full**. Off: "stop ponytail" / "normal mode". Switch: `/ponytail lite|full|ultra`. Caveman owns prose; ponytail owns what gets built. Load [`.agents/skills/ponytail/`](../../.agents/skills/ponytail/). On-demand: `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`.

### Linear issue implementation

Inside that flow, ship a Linear issue that already has `## Requirement` with `/to-spec` then `/implement`. Draft PR; a human merges. Bugs and refactors without a Requirement skip `/to-spec`.

Do **not** invent or file Linear issues during implement work. Filing a new requirement is a separate, explicit ask via [`.agents/skills/linear-requirement/`](../../.agents/skills/linear-requirement/) (`disable-model-invocation`).

### Translations

When deleting or changing `useTranslations()` / `getTranslations()` usage or `apps/web/messages/*.json` keys, follow [`.agents/skills/translations/`](../../.agents/skills/translations/).

### Verify Sokosumi

End-to-end launch, doctor, and browser proof for web + Core. First-party skill lives at [`.cursor/skills/verify-sokosumi/`](../../.cursor/skills/verify-sokosumi/) (not under `skills/`). Use `verify-sokosumi launch` / `doctor` / `sign-in` instead of inventing a local stack.

### Issue tracker

Issues live in Linear (team "Sokosumi", key `SOK`). When `linear` is on PATH, run the CLI for all Linear work and ignore Linear MCP (`linear__*`). Follow [`.agents/skills/linear-cli/`](../../.agents/skills/linear-cli/) for flags, `--json`, and `linear api`. If `command -v linear` fails, use Linear MCP. See [`docs/agents/issue-tracker.md`](../../docs/agents/issue-tracker.md).

### Triage labels

Hybrid mapping: native Linear statuses for needs-triage (Triage) and wontfix (Canceled); labels `needs-info` / `ready-for-agent` / `ready-for-human`. See [`docs/agents/triage-labels.md`](../../docs/agents/triage-labels.md).

### Domain docs

Single-context: live `CONTEXT.md` + `docs/adr/` at the repo root. See [`docs/agents/domain.md`](./domain.md).

**Instruction layout:** [`docs/agents/context-budget.md`](./context-budget.md) — which former root `AGENTS.md` sections live in which task-specific doc.

**Cloud agent database:** [`docs/agents/cloud-agent-database.md`](../../docs/agents/cloud-agent-database.md) — ephemeral Neon branch per agent run via `DATABASE_URL`, provision/teardown, 72h idle TTL.

**Coworker integrators:** [`docs/coworker/vendor-workspace-grants-api.md`](../../docs/coworker/vendor-workspace-grants-api.md) — vendor workspace grants, `GRANT_PENDING`, Core API error kinds. [`docs/coworker/coworker-workspace-access-api.md`](../../docs/coworker/coworker-workspace-access-api.md) — coworker early access (per-workspace pilot, not VendorGrant).

**Soko Bot:** contracts in [`packages/soko-bot`](../../packages/soko-bot) (`@sokosumi/soko-bot`); in-process runtime in Core (`apps/core/src/lib/soko-bot/`). See [`docs/adr/0007-soko-bot-eve-runtime.md`](../../docs/adr/0007-soko-bot-eve-runtime.md) — first-party personal project manager running inside Core, capability-scoped tools, context packets, memory, schedules, and admin operations. There is no `apps/soko-bot` deployable.
