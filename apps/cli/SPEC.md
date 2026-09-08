# SPEC

## §G GOAL
apps/cli slice 1: Developer CLI auth via browser OAuth or user API key. Thin Ink status screen. After sign-in, pick Coworker runtime (pi-sokosumi / Eve / Hermes / OpenClaw). User API-key mint depends on Core credential route. ⊥ marketplace TUI. ⊥ workspace connect / chat / Tasks (later slice).

## §C CONSTRAINTS
- live in monorepo `apps/cli`. ⊥ second CLI. ⊥ sibling `sokosumi-cli` edits. [VISION.md:43]
- talk Core HTTP only. ⊥ Prisma, ⊥ `@sokosumi/database`, ⊥ Postgres from CLI. [VISION.md:44]
- package identity ∈ {name: `sokosumi-cli`, bin: `sokosumi`}. [VISION.md:48]
- CLI source/tests ∈ TypeScript. Typecheck required.
- OAuth tokens & user API keys ∈ OS vault. Linux persistent auth → Secret Service. ⊥ plaintext credential file.
- API-key login ∈ user API keys only. ⊥ `coworker_*` key as CLI credential.
- API-key login target → reserved key prefix. Legacy untagged key → explicit target. ⊥ cross-target bearer probing.
- API-key input ∉ argv. Use env or stdin.
- signup/login ∈ web `/signin` during OAuth authorize. ⊥ CLI email/password form.
- public native client IDs target-scoped. PKCE. loopback `http://127.0.0.1/oauth/callback` + `http://[::1]/oauth/callback`. ⊥ `localhost`.
- consent on (`skipConsent: false`). scopes `openid sokosumi:api offline_access`.
- Biome format. Conventional Commits. pinned deps (no semver ranges).
- complements web `/developer`. ⊥ replace it. [VISION.md:45]

## §I INTERFACES

- cmd: `sokosumi` (no args) → Ink: auth method → OAuth target or API-key target detection → signed-in status + Register a Coworker (pi-sokosumi / Eve / Hermes / OpenClaw) + Sign out
- cmd: `auth login` → browser OAuth or env/stdin user API key
- cmd: `auth status` → text/JSON auth state
- cmd: `auth logout` → clear target-scoped local credentials; server key revocation separate
- global: `--json`, `--api-url`, `--preprod`, `--client-id`, `--api-key-stdin`
- env: `SOKOSUMI_MAINNET_OAUTH_CLIENT_ID`, `SOKOSUMI_PREPROD_OAUTH_CLIENT_ID`, `SOKOSUMI_AUTH_URL`, `SOKOSUMI_API_URL`, `SOKOSUMI_API_KEY`
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

## §B BUGS

id|date|cause|fix
