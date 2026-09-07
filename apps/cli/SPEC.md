# SPEC

## §G GOAL

apps/cli slice 1: Developer CLI login/signup via existing Better Auth OAuth. Thin Ink status screen. Core first-party client `sokosumi_cli`. ⊥ marketplace TUI. ⊥ coworker connect (later slice).

## §C CONSTRAINTS

- live in monorepo `apps/cli`. ⊥ second CLI. ⊥ sibling `sokosumi-cli` edits. [VISION.md:43]
- talk Core HTTP only. ⊥ Prisma, ⊥ `@sokosumi/database`, ⊥ Postgres from CLI. [VISION.md:44]
- package identity ∈ {name: `sokosumi-cli`, bin: `sokosumi`}. [VISION.md:48]
- OAuth tokens ∈ OS keychain. ⊥ web session cookie. ⊥ API key mint in slice 1.
- signup/login ∈ web `/signin` during authorize. ⊥ CLI email/password form.
- public native client `sokosumi_cli`. PKCE. loopback `http://127.0.0.1/oauth/callback` + `http://[::1]/oauth/callback`. ⊥ `localhost`.
- consent on (`skipConsent: false`). scopes `openid sokosumi:api offline_access`.
- Biome format. Conventional Commits. pinned deps (no semver ranges).
- complements web `/developer`. ⊥ replace it. [VISION.md:45]

## §I INTERFACES

binary: `sokosumi`; package: `sokosumi-cli`. shapes:

- cmd: `sokosumi` (no args) → Ink: signed-out Sign in | signed-in identity + Sign out
- cmd: `auth login` → PKCE browser hop → keychain tokens
- cmd: `auth logout` → clear keychain
- global: `--json`, `--api-url`, `--preprod`
- env: `SOKOSUMI_OAUTH_CLIENT_ID` (override), `SOKOSUMI_AUTH_URL`, `SOKOSUMI_API_URL`

## §V INVARIANTS

V1: CLI auth ∈ {OAuth access token, OAuth refresh token}. ⊥ session cookie. ⊥ API key in slice 1.
V2: provider key N/A this slice. later slices: provider key ∉ argv & ∉ logs.
V3: first-party client id `sokosumi_cli` is public metadata, not a secret.
V4: loopback redirects omit port. CLI may bind 53682 (RFC 8252 §7.3).
V5: CLI → Core HTTP only. ⊥ Prisma/DB import.
V6: `coworker_*` key ∉ dev CLI session.
V7: ⊥ second CLI product.
V8: signup/login happen in browser. CLI does not collect password.

## §T TASKS

id|status|task|cites
T1|x|package spec; binary `sokosumi`, package `sokosumi-cli`|V7,I
T2|.|scaffold `apps/cli` package (ESM, Ink, pinned deps)|V7,I
T3|.|OAuth PKCE + loopback + keychain|V1,V4,V8
T4|.|`auth login` / `auth logout` + `--json`|I,V1
T5|.|thin Ink login/status/sign-out|I
T6|.|Core seed `sokosumi_cli` native public client|V3,V4
T7|.|tests: protocol, manager, boot route, upsert|V1,V3
T8|.|coworker connect loop (later slice)|V5,V6

## §B BUGS

id|date|cause|fix
