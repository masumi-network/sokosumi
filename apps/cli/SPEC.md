# SPEC

## §G GOAL
apps/cli slice 1: canonical Sokosumi developer CLI. Auth via browser OAuth or user API key. Headless Core discovery, Agent, Coworker, Task, Job commands. Ink status/resource views. User API-key mint depends on Core credential route. ⊥ marketplace TUI. ⊥ workspace connect / chat (later slice).

## §C CONSTRAINTS
- live in monorepo `apps/cli`. ⊥ second CLI. ⊥ sibling `sokosumi-cli` edits. [VISION.md:43]
- talk Core HTTP only. ⊥ Prisma, ⊥ `@sokosumi/database`, ⊥ Postgres from CLI. [VISION.md:44]
- package identity ∈ {name: `sokosumi-cli`, bin: `sokosumi`}.
- CLI source/tests ∈ TypeScript. Typecheck required.
- OAuth tokens & user API keys ∈ OS vault. Linux persistent auth → Secret Service. ⊥ plaintext credential file.
- non-secret preferences ∈ optional `~/.sokosumi/config.json`. Accepted keys: `apiUrl`, `authUrl`, `webUrl`, `mainnetOAuthClientId`, `preprodOAuthClientId`. ⊥ token/key/client-secret fields.
- API-key login ∈ user API keys only. ⊥ `coworker_*` key as CLI credential.
- API-key login target → reserved key prefix. Legacy untagged key → explicit target. ⊥ cross-target bearer probing.
- API-key input ∉ argv. Use env or stdin.
- signup/login ∈ web `/signin` during OAuth authorize. ⊥ CLI email/password form.
- public native client IDs target-scoped. OAuth flow uses PKCE. loopback `http://127.0.0.1/oauth/callback` + `http://[::1]/oauth/callback`. ⊥ `localhost`.
- consent on (`skipConsent: false`). scopes `openid sokosumi:api offline_access`.
- TUI menus use arrows + Enter. Esc back. q quit. ⊥ letter/numeric aliases.
- Biome format. Conventional Commits. pinned deps (no semver ranges).
- complements web `/developer`. ⊥ replace it. [VISION.md:45]

## §I INTERFACES

- cmd: `sokosumi` (no args) → Ink: auth method → OAuth target or API-key target detection → signed-in Dashboard, Agents, Coworkers, Tasks, Jobs, Account, Register a Coworker, Sign out
- cmd: `auth login` → browser OAuth or env/stdin user API key
- cmd: `auth status` → text/JSON auth state
- cmd: `auth logout` → clear target-scoped local credentials; server key revocation separate
- cmd: `discover` → command catalog + Core resource snapshot; partial resource failure → JSON/text errors
- cmd: `agents list|hire`, `coworkers list|register|update|api-key|me`, `tasks list|create|get|events|jobs|comment`, `jobs list|get` → Core HTTP; `--json` → JSON-only stdout
- global: `--json`, `--api-url`, `--preprod`, `--client-id`, `--api-key-stdin`
- env: `SOKOSUMI_MAINNET_OAUTH_CLIENT_ID`, `SOKOSUMI_PREPROD_OAUTH_CLIENT_ID`, `SOKOSUMI_AUTH_URL`, `SOKOSUMI_API_URL`, `SOKOSUMI_API_KEY`
- file: `~/.sokosumi/config.json` → non-secret preferences only
- headless JSON fields: `authenticated`, `authMethod`, `apiKeyAvailable`, `target`, `apiUrl`, `expiresAt`

## §V INVARIANTS
V1: CLI auth ∈ {OAuth access token, OAuth refresh token, user API key}. ⊥ session cookie. ⊥ `coworker_*` key.
V2: provider key ∉ argv & ∉ logs.
V3: target → matching API URL, auth URL, public OAuth client ID, vault entry.
V4: loopback redirects omit port. CLI may bind 53682 (RFC 8252 §7.3).
V5: CLI → Core HTTP only. ⊥ Prisma/DB import.
V6: `coworker_*` key ∉ dev CLI session.
V7: ⊥ second CLI product.
V8: signup/login happen in browser OAuth. CLI does not collect password.
V9: persistent credentials ∈ OS vault. Linux → Secret Service. No plaintext fallback. No vault → explicit env/stdin only.
V10: API-key input ∉ argv. Target-coded prefix selects target locally. Legacy untagged key → explicit target. ⊥ bearer probe.
V11: OAuth credentials save before user-key mint. Mint failure preserves OAuth session and supports retry.
V12: user-key mint/rotate/revoke → Core feature with trusted CLI OAuth guard. CLI never mints locally.
V13: signed-in identity copy = auth method + target + signed-in state. ⊥ email/name on status screen.
V14: Register menu presets ∈ {pi-sokosumi, Eve, Hermes, OpenClaw}. Those are Coworker runtimes. ⊥ Hire Agent. Workspace connect later.
V15: vault writes use native secret setters or stdin; credential values ∉ child-process argv and error output.
V16: hosted target OAuth launch/refresh → target client ID configured; missing ID → pre-browser error, no fallback refresh.
V17: home config parser accepts only listed non-secret preference keys. ⊥ API key, access token, refresh token, client secret persistence.
V18: resource command data path → Core HTTP client → typed service. ⊥ direct database access.
V19: `--json` command → one parseable JSON document on stdout. ⊥ progress/text mixing.
V20: TUI selection → arrows + Enter. Esc back. q quit. ⊥ letter/numeric aliases.
V21: `coworkers register` request → Core create schema required `vendorId`; CLI accepts `--vendor-id`, emits `vendorId`, and rejects missing value before POST.
V22: CLI `test` and `test:ci` scripts pass the quoted recursive test glob to `tsx`; default suite collects nested command tests.
V23: hosted OAuth authorization and token URLs use the Core API auth base; legacy web `/api/auth` proxy preferences resolve to `<api>/auth`.

## §T TASKS

id|status|task|cites
T1|x|package spec; binary `sokosumi`, package `sokosumi-cli`|V7,I
T2|x|scaffold `apps/cli` package (ESM, Ink, pinned deps)|V7,I
T3|x|OAuth PKCE + loopback + keychain|V1,V4,V8
T4|x|`auth login` / `auth logout` + `--json`|I,V1
T5|x|thin Ink login/status/sign-out|I,V1,V13
T6|x|Core seed first-party native public OAuth clients|V3,V4
T7|x|tests: protocol, manager, boot route, upsert|V1,V3
T8|.|coworker connect loop (later slice)|V5,V6,V14
T9|x|signed-in Register a Coworker menu (preset pick only)|V13,V14
T10|x|migrate CLI source/tests to TypeScript; add typecheck|V1,V7
T11|x|add target-scoped auth resolution and cross-platform OS vault|V1,V3,V9,V10
T12|x|add OAuth/API-key auth method flow and stable headless JSON|V1,V8,V10,V13
T13|.|Core: add trusted CLI OAuth route for user-key mint/rotate/revoke; server controls target prefix + expiry; idempotency; reuse web developer key visibility|V11,V12
T14|x|load non-secret local/home config; preserve explicit env precedence|V17,I
T15|x|typed Core transport, tolerant models, and route services|V5,V18
T16|x|headless discovery, Agent, Coworker, Task, and Job commands|V18,V19,I
T17|x|selector TUI plus signed-in resource views|V20,V18,I

## §B BUGS

id|date|cause|fix
B1|2026-09-08|macOS vault writes passed serialized credentials through `security` argv and raw write errors reached CLI stderr|V15
B2|2026-09-08|hosted OAuth used silent `sokosumi_cli` fallback; Core flow ended `invalid_client`|V16
B3|2026-09-08|`coworkers register` omitted Core-required `vendorId`; Core create schema rejected the request|V21
B4|2026-09-08|CLI test scripts left recursive glob unquoted; shell expansion omitted nested command tests from default suite|V22
B5|2026-09-08|stale home `authUrl` pointed hosted CLI OAuth at the web `/api/auth` proxy, which returned redirect metadata instead of browser navigation|V23
