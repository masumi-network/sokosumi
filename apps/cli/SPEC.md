# SPEC

## §G GOAL
[REPORTED: user-approved direction, 2026-09-18] Single developer admin CLI; connect existing framework runtimes as Coworkers with optional capabilities, session/private/hosted lifetimes, and tested paid graduation. This amendment defines future requirements, not shipped features. TUI work paused; existing commands and auth guards preserved.

## §C CONSTRAINTS
- live in monorepo `apps/cli`. ⊥ second CLI. ⊥ sibling `sokosumi-cli` edits. [VISION.md constraints](VISION.md#constraints)
- talk Core HTTP only. ⊥ Prisma, ⊥ `@sokosumi/database`, ⊥ Postgres from CLI. [VISION.md constraints](VISION.md#constraints)
- package identity ∈ {private workspace name: `@sokosumi/cli`, package path: `apps/cli`, bin: `sokosumi`}; npm publication ⊥ current slice.
- CLI source/tests ∈ TypeScript. Typecheck required.
- OAuth tokens & user API keys ∈ OS vault. Linux persistent auth → Secret Service. ⊥ plaintext credential file.
- non-secret preferences ∈ optional `~/.sokosumi/config.json`. Accepted keys: `apiUrl`, `authUrl`, `webUrl`, `mainnetOAuthClientId`, `preprodOAuthClientId`. ⊥ token/key/client-secret fields.
- API-key login ∈ user API keys only. ⊥ `coworker_*` key as CLI credential.
- API-key login target → reserved key prefix. Legacy untagged key → explicit target. ⊥ cross-target bearer probing.
- API-key input ∉ argv. Use env or stdin.
- signup/login ∈ web `/signin` during OAuth authorize. ⊥ CLI email/password form.
- hosted public OAuth IDs built in: mainnet → `GxmewjdHVAaqUEglxWdyCqVFvnTASycj`, preprod → `lqhckIfBGmFhBMyCkbhvUkXHiatZVXwR`; explicit `--client-id`, target-specific, or generic `SOKOSUMI_OAUTH_CLIENT_ID` override. OAuth flow uses PKCE. Native clients = public (`application_type=native`, `token_endpoint_auth_method=none`) with canonical portless redirect `http://127.0.0.1/oauth/callback`; runtime redirect = `http://127.0.0.1:<port>/oauth/callback`, default port `53682` valid under RFC 8252 §7.3. Current CLI binds IPv4 only. ⊥ `localhost`; ⊥ claim current IPv6 runtime support.
- consent on (`skipConsent: false`). scopes `openid sokosumi:api offline_access`.
- TUI menus use arrows + Enter. Esc back. q quit. ⊥ letter/numeric aliases.
- v1 visual source = external user-provided `I-Want-You-Desing-Tui-Sokosumi` bundle. Production TUI = Ink/React. ⊥ HTML/CSS runtime, copied prototype fixtures, browser `localStorage`.
- Biome format. Conventional Commits. pinned deps (no semver ranges).
- complements web `/developer`. ⊥ replace it. [VISION.md constraints](VISION.md#constraints)

- direction authority: docs/adr/0004-coworker-capabilities-and-graduation.md; implementation dependencies: docs/developer-cli-implementation-plan.md. Core owns policy, grants, waitlisting, promotion, and payment authorization.
- historical external-bundle design constraint above applies only to deferred T27; no redesign prerequisite for integration.

## §I INTERFACES

- cmd: `sokosumi` (no args) → Ink: auth method → OAuth target or API-key target detection → signed-in Register a Coworker, Vendors, Workspaces, Sign out
- cmd: `auth login` → browser OAuth or env/stdin user API key
- cmd: `auth status` → text/JSON auth state
- cmd: `auth logout` → clear target-scoped local credentials; server key revocation separate
- cmd: `discover` → command catalog + Core resource snapshot; partial resource failure → JSON/text errors
- `agents list|hire`, `coworkers list|register|update|api-key|me`, `tasks list|create|get|events|jobs|comment`, `jobs list|get|input` → Core HTTP; `--json` → JSON-only stdout
- `vendors me` → administered Vendor memberships only; `workspaces list` → organization-workspace candidates with `organizationId`; text or one JSON document
- global: `--json`, `--api-url`, `--preprod`, `--client-id`, `--api-key-stdin`
- env: `SOKOSUMI_MAINNET_OAUTH_CLIENT_ID`, `SOKOSUMI_PREPROD_OAUTH_CLIENT_ID`, `SOKOSUMI_OAUTH_CLIENT_ID`, `SOKOSUMI_AUTH_URL`, `SOKOSUMI_API_URL`, `SOKOSUMI_API_KEY`; hosted OAuth IDs: mainnet `GxmewjdHVAaqUEglxWdyCqVFvnTASycj`, preprod `lqhckIfBGmFhBMyCkbhvUkXHiatZVXwR`; hosted auth base = selected API URL + `/auth`
- design: external `I-Want-You-Desing-Tui-Sokosumi` bundle primary file `sokosumi-tui-v1.html`; companions `DESIGN-HANDOFF.md`, `DESIGN-MANIFEST.json`, `brand-spec.md`; visual source only, ⊥ runtime asset.
- file: `~/.sokosumi/config.json` → non-secret preferences only
- headless JSON fields: `authenticated`, `authMethod`, `apiKeyAvailable`, `target`, `apiUrl`, `expiresAt`
- pkg: private workspace `@sokosumi/cli` @ `apps/cli` → source build emits bin `sokosumi`; npm publication ⊥ current slice

[VERIFIED: ADR 0005, 2026-09-21] Runtime identity/invocation contract approved: runtime bearer ∈ `coworker_*` only; developer OAuth/user API keys ⊥ runtime Core calls; session grant ⊥ identity; no short-lived developer-delegation JWT. Chat transport, general x402 purchase, and seller settlement interfaces still need their own approved contracts before implementation.

## §V INVARIANTS
V1: CLI auth ∈ {OAuth access token, OAuth refresh token, user API key}. ⊥ session cookie. ⊥ `coworker_*` key.
V2: provider key ∉ argv & ∉ logs.
V3: target → matching API URL, auth URL, public OAuth client ID, vault entry.
V4: native public client registration = portless `http://127.0.0.1/oauth/callback`; runtime redirect = `http://127.0.0.1:<port>/oauth/callback`, default port `53682` valid under RFC 8252 §7.3. Current CLI runtime = IPv4 only. ⊥ `localhost`; ⊥ claim current IPv6 runtime support.
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
V16: hosted target OAuth launch/refresh → registered target client ID (`GxmewjdHVAaqUEglxWdyCqVFvnTASycj` mainnet, `lqhckIfBGmFhBMyCkbhvUkXHiatZVXwR` preprod) by default; explicit `--client-id`, target-specific, or generic `SOKOSUMI_OAUTH_CLIENT_ID` override; resolved ID stays consistent through refresh.
V17: home config parser accepts only listed non-secret preference keys. ⊥ API key, access token, refresh token, client secret persistence.
V18: resource command data path → Core HTTP client → typed service. ⊥ direct database access.
V19: `--json` command → one parseable JSON document on stdout. ⊥ progress/text mixing.
V20: TUI selection → arrows + Enter. Esc back. q quit. ⊥ letter/numeric aliases.
V21: `coworkers register` request → Core create schema required `vendorId`; CLI accepts `--vendor-id`, emits `vendorId`, and rejects missing value before POST.
V22: CLI `test` and `test:ci` scripts pass the quoted recursive test glob to `tsx`; default suite collects nested command tests.
V23: hosted OAuth authorization and token URLs use the Core API auth base; legacy web `/api/auth` proxy preferences resolve to `<api>/auth`.
V24: hosted target OAuth auth base = selected API URL + `/auth`; auth URL overrides apply only to custom targets.
V25: successful loopback OAuth callbacks return no-store HTML that removes code and state from the browser address bar.
V26: workspace package marked private; source build → bin `sokosumi`; npm publication ⊥ until separate official release work.
V27: browser launch failure → OAuth login rejects immediately & clears callback timer.
V28: custom API URL → injective vault scope encoding; distinct canonical URLs → distinct vault entries
V29: custom vault scope alphabet ∈ lowercase hex; case-insensitive vault names → distinct canonical URLs stay distinct
V30: explicit API target (flag/env) → precedes API-key target inference
V31: mainnet/preprod resource request → API-key target matches selected target before bearer
V32: TUI hosted target selection → explicit selected API URL
V33: direct browser GET `/auth/oauth2/authorize` → HTTP redirect to Better Auth's returned URL; other auth responses keep their JSON envelope.
V34: TUI hosted target selection → preserve explicit `--client-id`; without an override, resolve the selected target's client ID and default.
V35: CLI `--version` output = package manifest `version`.
V36: source-built hosted CLI → registered target OAuth ID (`GxmewjdHVAaqUEglxWdyCqVFvnTASycj` mainnet, `lqhckIfBGmFhBMyCkbhvUkXHiatZVXwR` preprod) + Core auth base (selected API URL + `/auth`) without local `.env` or runtime client-ID configuration; overrides optional.
V37: hosted target OAuth readiness gate → real authorization-code exchange returns token for mainnet & preprod; metadata/authorize-only checks insufficient.
V38: `sokosumi` no-arg source run → Ink directly; ⊥ npm registry check/update prompt.
V39: CLI runtime ⊥ invoke npm/package manager/self-update; distribution ∉ current runtime.
V40: [Deferred T27 scope, 2026-09-18; not an integration prerequisite] external v1 design bundle → Ink/React TUI visual source; ⊥ HTML/CSS runtime, copied demo data, browser `localStorage`; live Core data only.
V41: [Deferred T27 scope, 2026-09-18; not an integration prerequisite] v1 TUI → dark terminal chrome + centered ASCII sign-in states + signed-in tab/workspace/pane states + visible selection/status state variants; ⊥ change to arrows + Enter, Esc back, q quit, SPEC V13 identity copy.
V42: every headless Core-backed command resolves initial auth before any Core call; unauthenticated preflight rejects before Core and `--json` emits exactly one stdout JSON error document with credentials redacted and no stderr copy.
V43: TUI explicit target selection (flag/env/API URL) is authoritative; a prefixed API key cannot rewrite it and a mismatched prefix rejects before login.
V44: untagged API keys require an explicit target (`--preprod` or `--api-url`) before auth status/login; ⊥ implicit hosted-default acceptance.
V45: raw API-key input treats `q` as key data; Ctrl+C/Esc cancel the active input without accepting the partial key.
V46: [Deferred 2026-09-21; stale vs current signed-in home; no dashboard] dashboard resource counts use finite Core pagination metadata totals when present; fallback to current-page length only when metadata has no usable total.
V47: error redaction recursively replaces credential-shaped fields regardless of casing/separators/nesting, and credential values do not remain in rendered/serialized errors.
V48: source CLI runtime ∉ {npm registry request, package-manager child process, self-update install}; secrets cannot cross removed updater boundary.
V49: unsupported inline option values are rejected without echoing the supplied value in diagnostics, including `--json` output.
V50: leaving API-key input/target selection by Ctrl+C/Esc clears the pending full key before any later TUI action; ⊥ stale key reuse.
V51: explicit custom `--api-url` target rejects target-coded mainnet/preprod environment or stored API keys before bootstrap proceeds.
V52: OAuth completion observing an aborted/canceled login cannot save credentials or transition the TUI to authenticated/success.
V53: every Ink/React TUI layout prop ∈ the installed Ink/React type surface; `pnpm --filter @sokosumi/cli build` passes without unsupported props such as `marginRight` or `maxWidth`.
V54: every React/Ink TUI test callback passed to a component prop is assignable to the installed component prop type; `pnpm --filter @sokosumi/cli typecheck` passes without strict-function-variance failures.
V55: every user-visible `apiUrl` in auth login/status, discover, and TUI output passes the canonical `sanitizeApiUrl`; userinfo, fragments, and credential-shaped query keys never appear.
V57: custom vault scope material = lowercase-hex encoding of `sanitizeApiUrl(apiUrl)`; userinfo, fragments, and credential-shaped query values never enter keyring account names while distinct sanitized URLs remain distinct.
V58: reserved `coworker_*` API keys are rejected before any auth-manager/Core call and never accepted or saved by CLI login.
V59: malformed home config under `--json` emits exactly one parseable redacted stdout error document and no stderr copy.
V60: Ink is the sole raw-input owner during API-key entry; q is key data, Enter submits, and Esc/arrows remain TUI navigation without competing stdin ownership.
V61: `sanitizeApiUrl` removes standalone credential query keys `key` and `access_key` (case-insensitive) from every user-visible URL and custom vault scope while preserving non-credential keys such as `monkey`.
V62: default no-arg source run → status/auth Ink screen; ⊥ updater screen or update input handling.
V63: error redaction recursively sanitizes credential-shaped `key=value` pairs inside nested string fields, including CoreApiError/discover JSON; secret values never remain in rendered/serialized output.
V64: CLI direct `@types/react` pin = workspace React types pin; workspace typecheck sees one React type identity.
V65: `secret-tool` lookup exit status 1 with empty/whitespace-only stderr or explicit missing-item text means a missing item and leaves Secret Service supported; any other error fails closed.

[REPORTED: user-approved requirements, 2026-09-18; not yet implementation claims]
V66: developer CLI = admin control; runtime actor = Coworker; Coworker may hire Masumi Agents. No developer credential fallback for runtime work.
V67: workspace exists before registration; Vendor controlled by developer or authorized company. Unrelated developers never share default Vendor authority.
V68: session-only, retained workspace-only, persistent hosted modes explicit; session expiry/revocation removes temporary authority without deleting identity or shared work history.
V69: capabilities optional; no fixed graduation order beyond actual dependencies. Active-session tools and automatic workers distinct; advertised support requires proof.
V70: Core owns grants, readiness policy, waitlist, promotion, payment authorization; CLI only configures/displays through approved interfaces.
V71: readiness derives from canonical grants, connection health, payment configuration; only non-derivable test evidence persisted, bound to configuration and validity.
V72: paid eligibility requires baseline safety, seller receipt, and advertised-capability tests; eligibility ≠ admin approval; global availability ≠ all-workspace access.
V73: private own-workspace use has no automatic seller fee; model costs and authorized purchases remain payable. Public paid usage charges reviewed seller prices.
V74: seller submits usage pricing with waitlist application; new public price version requires review; existing authorized work retains accepted price and spending ceiling.
V75: x402 funding explicitly selected ∈ {workspace credits, runtime-held wallet}; no silent fallback. Supported rails/assets, authorization, spending limits still apply to external services.
V76: customer debit ≠ seller settlement; paid-graduation evidence must prove service delivery and intended seller receipt. Coworker-reported amount alone is not customer price authorization.
V77: public paid runtime isolated from developer credentials; trusted private same-user session not advertised as isolated. Container/cloud label alone proves nothing.
V78: runtime secrets never in argv, model-visible output, logs, or non-secret config; session-only → memory; retained/hosted → OS vault (ADR 0005).
V79: `vendors me` → preserve Vendor memberships + roles; registration selection later requires role = `admin`; `workspaces list` identity = `organizationId`; organization metadata ∉ output; non-array list or missing required identity → fail; `--json` → one document.
V80: shared discovery handler ! exact subcommand before Core call; bare `vendors` / `workspaces` → reject.

[VERIFIED: ADR 0005, 2026-09-21]
V81: runtime bearer ∈ `coworker_*` only; developer OAuth/user API key (`soko_*`, incl. SOK-1135 mint) ⊥ runtime Core calls; short-lived developer-delegation JWT ⊥ approved contract (ADR 0005).
V82: session grant ⊥ Coworker identity and key material; expiry/disconnect remove temporary authority only; reconnect requires authorization (ADR 0005).
V83: mint/rotate/revoke `coworker_*` ∈ developer auth only (interactive or headless); runtime ⊥ self-mint (ADR 0005).
V84: CLI/TUI/skill share in-process handlers; ⊥ recursive CLI entrypoint; runtime adapters → Core HTTP with `coworker_*` (ADR 0005).
V85: `coworkers register` requires ≥1 organization workspace and `--vendor-id` ∈ administered (`admin`) memberships; foreign/non-admin Vendor ⊥ before Core create; register ⊥ Vendor create (developer Vendor create is standalone `vendors create` → `POST /v1/vendors`, caller admin); Coworker create ∈ platform admin only; blocked copy points to `vendors create` for Vendor setup.
V86: registration gate copy ⊥ Vendor member-invite / role-promotion instructions; CLI has no invite/accept command.
V87: account deletion writes (not only locks) every current Vendor row in stable `vendorId` order, revokes PENDING invites to Vendors the user alone administers, then rechecks V89 inside the same transaction before the User cascade; membership role changes/removals lock the same Vendor row in a Serializable transaction ∴ one queued behind deletion fails serialization and retries on current data; a concurrent invite accept commits first (recheck sees the member) or fails serialization on the revoked invite row.
V88: Vendor invite acceptance reads the current verified account email inside its Serializable transaction before matching and accepting the invite; a stale pre-transaction email ⊥ authorization.
V89: account deletion ⊥ while the user is a Vendor's sole admin and the Vendor has another member or an unarchived Coworker; otherwise deletion proceeds and the Vendor stays admin-less. Intentionally looser than member PATCH/DELETE, which never leave 0 admins. Coworker create/unarchive (platform admin only) ⊥ Vendor lock.

## §T TASKS

id|status|task|cites
T1|x|package spec; private workspace package `@sokosumi/cli`, path `apps/cli`, binary `sokosumi`|V7,I
T2|x|scaffold `apps/cli` package (ESM, Ink, pinned deps)|V7,I
T3|x|OAuth PKCE + loopback + keychain|V1,V4,V8
T4|x|`auth login` / `auth logout` + `--json`|I,V1
T5|x|thin Ink login/status/sign-out|I,V1,V13
T6|x|Core seed first-party native public OAuth clients|V3,V4
T7|x|tests: protocol, manager, boot route, upsert|V1,V3
T8|.|coworker connect loop; gated on T29 runtime contract; see implementation plan|V5,V6,V14,V66,V67,V68
T9|x|signed-in Register a Coworker menu (preset pick only)|V13,V14
T10|x|migrate CLI source/tests to TypeScript; add typecheck|V1,V7
T11|x|add target-scoped auth resolution and cross-platform OS vault|V1,V3,V9,V10
T12|x|add OAuth/API-key auth method flow and stable headless JSON|V1,V8,V10,V13
T13|.|Core: add trusted CLI OAuth route for user-key mint/rotate/revoke; server controls target prefix + expiry; idempotency; reuse web developer key visibility|V11,V12
T14|x|load non-secret local/home config; preserve explicit env precedence|V17,I
T15|x|typed Core transport, tolerant models, and route services|V5,V18
T16|x|headless discovery, Agent, Coworker, Task, and Job commands|V18,V19,I
T17|x|selector TUI plus signed-in resource views|V20,V18,I
T18|~|retire deleted npm release; keep source-only package/bin|V26,I
T19|x|fail browser launch without callback timeout|V27
T20|x|custom target vault scope → canonical URL encoding|V28
T21|x|custom vault scope → lowercase hex byte encoding; Windows case-fold test|V29
T22|x|resource request → preflight API-key target check|V31
T23|x|configured API target → key-prefix inference precedence|V30
T24|x|TUI hosted target → explicit API URL override|V32
T25|x|preprod live OAuth smoke: fresh authorization-code exchange → token; compare mainnet/preprod|V37,I
T26|x|remove npm-global updater, prompt, tests, and runtime package-manager calls|V38,V39,V48,V62,I
T27|.|DEFERRED 2026-09-18; not completed or integration prerequisite: redesign Ink TUI against external v1 bundle: terminal chrome, sign-in, tabs/workspace, state variants, PTY widths|V40,V41,I
T28|~|align CLI React types pin with workspace and sync lockfile|V64

T29|x|approve runtime identity/invocation contract; reject short-lived developer-delegation JWT; keep developer-key guards|V1,V6,V58,V66,V77,V78,V81,V82,V83,V84
T30|.|Core prerequisites and CLI private setup: Vendor/workspace authority, self-service registration, session lifecycle|V67,V68,V70
T31|.|active-session Task/Job operations and automatic worker; prove recovery and authorization separately|V66,V69,V77,V78
T32|.|approve chat transport; implement permitted direct/chat-channel/group participation and revocation|V69,V70,V77
T33|.|approve Masumi funding/custody contract; general x402 services within authorized rails and limits|V70,V75,V76
T34|.|Core seller usage-price authorization, version review, settlement and controlled payment evidence|V73,V74,V76
T35|.|Core readiness derivation, capability evidence, waitlist review; CLI exposes status without self-approval|V70,V71,V72
T36|x|CLI read-only administered Vendor + organization-workspace discovery|V18,V19,V42,V67,V79,V80,I
T37|x|CLI registration gates: workspace required, admin Vendor only; register ⊥ Vendor create; developer Vendor create via standalone `vendors create` → Core `POST /v1/vendors`|V67,V79,V85,I

## §B BUGS

id|date|cause|fix
B1|2026-09-08|macOS vault writes passed serialized credentials through `security` argv and raw write errors reached CLI stderr|V15
B2|2026-09-08|hosted OAuth used silent `sokosumi_cli` fallback; Core flow ended `invalid_client`|V16
B3|2026-09-08|`coworkers register` omitted Core-required `vendorId`; Core create schema rejected the request|V21
B4|2026-09-08|CLI test scripts left recursive glob unquoted; shell expansion omitted nested command tests from default suite|V22
B5|2026-09-08|stale home `authUrl` pointed hosted CLI OAuth at the web `/api/auth` proxy, which returned redirect metadata instead of browser navigation|V23
B6|2026-09-08|hosted preprod selected the mainnet `authUrl` from home config instead of deriving auth from the selected API target|V24
B7|2026-09-08|successful OAuth callback left one-time code and state in the browser address bar|V25
B8|2026-09-08|auth login passed raw `--auth-url` over resolved hosted target config, so `--preprod` could launch mainnet auth|V24
B9|2026-09-08|browser spawn failure resolved before spawn error; callback timer stayed pending until timeout|V27
B10|2026-09-08|host punctuation collapsed into same custom vault scope ∴ API key could route to wrong host|V28
B11|2026-09-08|percent-encoded URL scope differed only by case; Windows vault folds names ∴ paths shared credential|V29
B12|2026-09-08|resource command skipped API-key target validation ∴ mismatched bearer sent to Core target|V31
B13|2026-09-08|target-coded key overrode configured API URL ∴ request routed to wrong Core|V30
B14|2026-09-08|TUI Mainnet choice retained preprod API URL ∴ target selection did not switch host|V32
B15|2026-09-09|hosted CLI OAuth authorization received Better Auth's `{redirect,url}` envelope as JSON, so browser navigation did not reach consent|V33
B16|2026-09-09|TUI hosted target selection rebuilt config without carrying explicit `--client-id` ∴ a valid override was lost before browser launch|V34
B17|2026-09-10|release version changed manifest but binary test hardcoded prior version|V35
B18|2026-09-10|generic mock callbacks omitted parameter annotations ∴ CLI typecheck failed|-
B19|2026-09-10|VERIFIED manifest omission: package omits local `apps/cli/.env` ∴ unregistered `sokosumi_cli` fallback; REPORTED user error: old published bundle used `https://app.sokosumi.com/api/auth`, not Core auth base|V36
B20|2026-09-10|REPORTED worker evidence: preprod metadata + authorize passed; fake code → 400 `invalid_grant`; exact local cmd `env -u SOKOSUMI_API_URL -u SOKOSUMI_AUTH_URL -u SOKOSUMI_OAUTH_CLIENT_ID -u SOKOSUMI_MAINNET_OAUTH_CLIENT_ID -u SOKOSUMI_PREPROD_OAUTH_CLIENT_ID -u SOKOSUMI_OAUTH_CLIENT_SECRET -u SOKOSUMI_API_KEY node apps/cli/dist/bin/sokosumi.js auth login --preprod --json --oauth-timeout-ms 180000` → OAuth token request failed with status 500; user reports wrong preprod `BETTER_AUTH_SECRET` caused JWK token verification failure, followed by successful preprod OAuth exchange; mainnet OAuth succeeds per user report; Core issue SOK-1040 tracks reported cause|V37
B21|2026-09-11|Core-backed headless dispatch discarded `resolveInitialAuth`'s unauthenticated result, allowing Core calls without credentials; JSON failures lacked one redacted stdout document|V42
B22|2026-09-11|TUI API-key login inferred a prefixed key's target even after an explicit target was selected, allowing the key to override the chosen Core host|V43
B23|2026-09-11|legacy untagged API keys fell through the hosted default without proving which target they belonged to|V44
B24|2026-09-11|raw API-key q/cancel handling could accept the wrong terminal action or leave a partial key input active|V45
B25|2026-09-11|DEFERRED 2026-09-21 (no dashboard on current signed-in home): dashboard counted only the current Core page, so paginated resources displayed page length instead of metadata totals|V46
B26|2026-09-11|credential-shaped error fields were redacted only for limited casing/flat shapes, leaking nested or separator variants|V47
B27|2026-09-11|npm self-update inherited process secrets/configuration and allowed package lifecycle scripts during install|V48
B28|2026-09-11|unsupported `--name=value` options exposed the supplied value in parser diagnostics|V49
B29|2026-09-11|pendingApiKey retained the full untagged key after API-key cancellation or Escape from target selection, leaving stale credential state in the TUI|V50
B30|2026-09-11|explicit custom API URLs allowed target-coded mainnet/preprod environment keys through bootstrap instead of rejecting a cross-target credential|V51
B31|2026-09-11|OAuth completion continued after cancellation and could save credentials or enter success after the login was aborted|V52
B32|2026-09-11|Ink TUI used `Text.marginRight` and `Box.maxWidth`, which the installed Ink/React types reject and caused the CLI build to fail|V53; verify `pnpm --filter ./apps/cli build`
B33|2026-09-11|`select-input.test.ts` narrowed React's inferred `onSelect` value from `unknown` to `string`, so strict callback variance broke the CLI typecheck|V54; verify `pnpm --filter ./apps/cli typecheck`
B34|2026-09-11|custom API URL userinfo and credential-shaped query parameters leaked through auth login/status, discover, and TUI output because each surface lacked one canonical output sanitizer|V55
B35|2026-09-11|custom vault scope encoded raw API URLs, so keyring account names inherited userinfo and credential-shaped query material|V57
B36|2026-09-11|reserved `coworker_*` API keys reached credential acceptance paths instead of being rejected before save or Core auth calls|V58
B37|2026-09-11|malformed home config failed before the JSON-aware error boundary, so `--json` produced no error document|V59
B38|2026-09-11|raw API-key input installed a competing stdin/raw-mode owner, so Ink Esc/arrow navigation and key capture conflicted|V60
B39|2026-09-11|credential query keys named `key` and `access_key` were not classified as credentials, so sanitizer output and decoded custom vault scopes retained their values|V61
B40|2026-09-11|probe confirmed V47 redacted object keys but nested string fields retained credential-shaped `key=value`; real CoreApiError/discover JSON leaked `apiKey=soko_mainnet_secret` and `refreshToken=soko_refresh_secret`|V63
B41|2026-09-11|npm updater built command lines from user-controlled environment ∴ CodeQL found 2 critical uncontrolled-command alerts|V39
B42|2026-09-11|CLI pinned `@types/react@19.2.18` beside workspace `19.3.0` ∴ Web build/typecheck saw unrelated React `Key`/`Ref` types|V64
B43|2026-09-11|updater bin tests used manifest `2.1.4` as both current/latest ∴ update path did not run and 3 CLI tests failed|V38
B44|2026-09-12|GNOME `secret-tool` lookup returns status 1 with empty stderr for a missing item; text-only detection rejected a healthy empty vault|V65
B45|2026-09-20|admin-only Vendor filter exposed dispatch fixture without role; expected candidate disappeared|V79
B46|2026-09-20|direct workspace guard used multiline form rejected by Biome formatter|§C Biome
B47|2026-09-20|optional direct-handler guard accepted bare `vendors` / `workspaces` calls|V80
B48|2026-09-20|workspace JSON forwarded arbitrary organization metadata without allowlist|V79
B49|2026-09-20|admin-only discovery conflated membership listing with later registration selection|V79
B50|2026-09-23|VERIFIED diff: gate copy said `member invite or role promote`; INFERRED from Coworkers usage `list`, `register`, `update`, `api-key`, `me` (`src/cli/index.ts:152-156`): CLI has no invite/accept command|V86
B51|2026-09-23|VERIFIED test output: V87 regression resolved `undefined` instead of rejecting when the in-transaction admin count was one|V87
B52|2026-09-23|VERIFIED test output: V88 regression returned HTTP 201 after the email changed before the acceptance transaction; expected 404|V88
B53|2026-09-24|VERIFIED scratch Postgres: deletion FOR UPDATE + queued Serializable demotion ended with 0 admins (demotion snapshot predated the lock wait); row write → `could not serialize`, retry saw 1 admin|V87
B54|2026-09-24|INFERRED from review: sole admin who is the Vendor's only member had no promotable member and no leave/delete route ∴ account deletion was blocked permanently|V89
B55|2026-09-24|INFERRED from spec review: after V89 let a solo admin delete, a PENDING invite outlived them and its accept would add a member to the admin-less Vendor|V87
