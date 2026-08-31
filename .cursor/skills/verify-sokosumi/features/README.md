# Sokosumi verification map

Maintained source for verifying user-facing Sokosumi behavior. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `verify-sokosumi launch` (portless HTTPS named URLs). Read `web_url=` / `core_url=` from `verify-sokosumi doctor` — do not guess `:3000` / `:8787`. Record pids in `.cursor/verify-sokosumi-artifacts/state/dev.pids`.
- Run `.cursor/skills/verify-sokosumi/bin/verify-sokosumi doctor` and require `doctor ok` with `owned_by_verify=yes`.
- Export the named URLs before driving recipes:
  `export WEB_URL="$(pnpm portless:url web)" CORE_URL="$(pnpm portless:url core)"`
  (or copy `web_url=` / `core_url=` from doctor).
- Export `AGENT_BROWSER_SESSION_NAME=sokosumi`. `verify-sokosumi` aliases that to `AGENT_BROWSER_SESSION` (agent-browser 0.35+ session isolation) when `AGENT_BROWSER_SESSION` is unset. Manual drives should set both or rely on the harness.
- Prefer fixture `alice@sokosumi.test` / `Password123!` on cloud-agent Neon branches. On a coworker machine or shared Neon, use the `sokosumi` vault (`sign-in --method vault`) or a disposable user (see [Sign up](./sign-up.md)). Do **not** seed Alice onto a shared/preprod database.
- Use the doctor `web_url=` (a `*.localhost` name), not `127.0.0.1`. Better Auth origin/cookies follow that host.
- Confirm `apps/core/.env` does not set a production `BETTER_AUTH_COOKIE_DOMAIN`. Doctor allows `localhost` or `sokosumi.localhost`. Portless injects `sokosumi.localhost` in process env.
- After doctor, authenticate with `.cursor/skills/verify-sokosumi/bin/verify-sokosumi sign-in` (fixtures, then vault). Expect `fixture_auth=ok` only on agent Neon branches.
- Never drive an instance that was not started by this verification run.
- Put proof under `.cursor/verify-sokosumi-artifacts/<feature-id>/` (gitignored). Cleanup must keep those files.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer `data-testid` and accessible names over CSS position or coordinates.
- Sign-in: prefer `verify-sokosumi sign-in`. Manual drive: fill email/password testids only, then `agent-browser press Enter` (do not click submit or OAuth/passkey/magic-link).
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
- [Browse agents](./browse-agents.md) — `/agents` coworker gallery (search / offers; not marketplace catalog).
- [Chat landing](./chat-landing.md) — authenticated default Welcome at `/` (not Ably messaging; `/chat` is adjacent).
- [Tasks board](./tasks-board.md) — `/tasks` task manager shell (kanban / tabs).
- [Projects](./projects.md) — `/projects` list or empty state.
- [Jobs history](./jobs-history.md) — `/history` unified History (tasks + jobs) for the signed-in user.
- [Sign up](./sign-up.md) — disposable account creation when fixtures are absent.
