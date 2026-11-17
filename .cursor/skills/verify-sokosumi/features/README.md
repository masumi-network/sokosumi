# Sokosumi verification map

Maintained source for verifying user-facing Sokosumi behavior. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Fast path: `local-stack up` then `drive.mjs <journey>` (see SKILL.md). Its Web URL is `http://localhost:3100` and Alice is seeded. The bullets below are for the portless/agent-browser path.

- Launch with `verify-sokosumi launch` (portless HTTPS named URLs). Read `web_url=` / `core_url=` from `verify-sokosumi doctor` — do not guess `:3000` / `:8787`. Record pids in `.cursor/verify-sokosumi-artifacts/state/dev.pids`.
- Run `.cursor/skills/verify-sokosumi/bin/verify-sokosumi doctor` and require `doctor ok` with `owned_by_verify=yes`.
- Export the named URLs before driving recipes:
  `export WEB_URL="$(pnpm portless:url web)" CORE_URL="$(pnpm portless:url core)"`
  (or copy `web_url=` / `core_url=` from doctor).
- Export `AGENT_BROWSER_SESSION_NAME=sokosumi`. `verify-sokosumi` aliases that to `AGENT_BROWSER_SESSION` (agent-browser 0.35+ session isolation) when `AGENT_BROWSER_SESSION` is unset. Manual drives should set both or rely on the harness.
- Auth order: `VERIFY_SOKOSUMI_EMAIL` / `VERIFY_SOKOSUMI_PASSWORD` first (`verify-sokosumi credentials-status` / doctor). Then fixture `alice@sokosumi.test` / `Password123!` only when `fixture_auth=ok` on cloud-agent Neon. On a coworker machine or shared Neon, use the `sokosumi` vault (`sign-in --method vault`). Disposable signup (see [Sign up](./sign-up.md)) is **only** for testing signup — never invent random users as a computer-use fallback. Do **not** seed Alice onto a shared/preprod database.
- Use the doctor `web_url=` (a `*.localhost` name), not `127.0.0.1`. Better Auth origin/cookies follow that host.
- Confirm `apps/core/.env` does not set a production `BETTER_AUTH_COOKIE_DOMAIN`. Doctor allows `localhost` or `sokosumi.localhost`. Portless injects `sokosumi.localhost` in process env.
- After doctor, authenticate with `.cursor/skills/verify-sokosumi/bin/verify-sokosumi sign-in` (fixtures, then vault). Expect `fixture_auth=ok` only on agent Neon branches.
- Tasks, Agents, Schedules, Projects, Files, and Credit history sit behind the organization-product layout. A user with no assigned seat sees **Assigned seat required** instead of the feature. Cloud-agent fixture Alice has a seat. That screen is a seat lock, not a missing route.
- Never drive an instance that was not started by this verification run.
- Put proof under `.cursor/verify-sokosumi-artifacts/<feature-id>/` (gitignored). Cleanup must keep those files.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer `data-testid` and accessible names over CSS position or coordinates.
- Sign-in: prefer `verify-sokosumi sign-in`. Manual drive: fill the email testid, `agent-browser press Enter`, switch step 2 to the password (`auth-use-password`), fill it, `press Enter` (do not click submit or OAuth/passkey).
- Re-snapshot after navigation (`agent-browser snapshot -i`).
- Treat Ably/chat realtime failures as environment gaps unless the feature under test is chat messaging.
- Prefer `agent-browser`. Cloud Agent computer-use is allowed with the same rules when the CLI harness is unavailable.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes a screenshot and an interactive snapshot with Sokosumi chrome visible.
- Mutation proof includes a second read (reload or navigate away and back).
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with agent-browser` (or `Driving it with curl` when API-only)
4. `Gotchas`

## Features

- [Sign in](./sign-in.md) — email/password session, Welcome `/` landing, persist on `/agents`.
- [Browse agents](./browse-agents.md) — `/agents` coworker gallery + Agent catalog (no app Hire / price).
- [Chat landing](./chat-landing.md) — authenticated default home at `/` (**Get your Soko Bot** with no personal bot, or that bot's home when the user has one). **Catch up** is `/chat/catch-up`, not the home page.
- [Soko Bots](./soko-bots.md) — `/soko-bots` team assistants (top sidebar **Soko Bots**).
- [Tasks board](./tasks-board.md) — `/tasks` task manager (Board; kanban or list). Old `?tab=calendar` redirects to `/calendar`.
- [Schedules](./schedules.md) — `/schedules` task-schedule list (All / Active / Paused / Ended).
- [Contacts](./contacts.md) — `/contacts` team contacts (All / My / Recently added), including the empty state.
- [Calendar](./calendar.md) — `/calendar` Work sidebar row after Schedules; Month / Week / Agenda with a Show filter.
- [Content Studio](./studio.md) — `/studio` image studio (named styles with no `?projectId=`; picker only for a missing project).
- [Studio ad generation](./studio-ad-generation.md): brief to ads in a project; Auto model routing; needs provider keys.
- [Studio ad ratings](./studio-ratings.md): thumbs, reasons, comment on a generated ad; must survive reload.
- [Social posts](./social.md) — `/social` post calendar (Marketing group; sidebar label **Social posts**).
- [SEO](./seo.md) — `/seo` Marketing row. An empty workspace shows **Start your first SEO audit**; otherwise the audit list.
- [Ads](./ads.md) — `/ads` Marketing row. With no project in scope, sample ads and **Pick a project**.
- [Newsletter](./newsletter.md) — `/newsletter` only in the newsletter beta organization. Elsewhere the sidebar row is absent and the URL is a 404.
- [Projects](./projects.md) — `/projects` card grid or empty state (desktop **Work** row under **Home**).
- [Files](./files.md) — `/drive` Recents / Workspace / Tables (desktop main nav **Files**).
- [History](./history.md) — `/history` credit history ledger (account menu / You; not a sidebar row).
- [Sign up](./sign-up.md) — disposable account creation when fixtures are absent.
