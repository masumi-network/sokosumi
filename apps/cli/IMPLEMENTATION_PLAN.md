# CLI Consolidation Implementation Plan

> **For agentic workers:** Use task-by-task execution with a focused review after each task. Every task must preserve the contracts in `apps/cli/SPEC.md`.

**Goal:** Make `apps/cli` the only Sokosumi CLI source, fix target-aware OAuth login, simplify the TUI, and port the sibling CLI's useful Core commands without copying its insecure credential storage.

**Architecture:** `apps/cli` owns the binary, TypeScript source, tests, configuration, credential boundary, HTTP client, commands, and Ink views. The CLI talks to Core HTTP routes only. Non-secret preferences live in `~/.sokosumi/config.json`; OAuth tokens and user API keys stay in target-scoped OS credential stores or transient environment/stdin input.

**Tech Stack:** Node.js 24, TypeScript, ESM, Ink 4, React 18, native Node filesystem APIs, `@napi-rs/keyring`, Linux Secret Service, Core HTTP API.

**Spec:** `apps/cli/SPEC.md`

## Global Constraints

- Source of truth is `apps/cli`; do not add new product code to `/Volumes/Sarthi MAC/Soko/sokosumi-cli`.
- CLI database access is forbidden. Use Core HTTP routes only.
- External package versions in `package.json` stay exact and pinned.
- Hosted OAuth IDs are registered and built in: mainnet `GxmewjdHVAaqUEglxWdyCqVFvnTASycj`, preprod `lqhckIfBGmFhBMyCkbhvUkXHiatZVXwR`. Hosted clients = public native (`application_type=native`, `token_endpoint_auth_method=none`) with canonical portless redirect `http://127.0.0.1/oauth/callback`; runtime redirect = `http://127.0.0.1:<port>/oauth/callback`, default port `53682` valid under RFC 8252 §7.3. Core auth derives from selected API URL + `/auth`; explicit client IDs remain optional overrides. OAuth tokens, API keys, and client secrets never enter plaintext config files.
- API-key values never enter process arguments or diagnostic errors.
- Registered hosted OAuth clients (`GxmewjdHVAaqUEglxWdyCqVFvnTASycj` mainnet, `lqhckIfBGmFhBMyCkbhvUkXHiatZVXwR` preprod) must exist in each hosted Core database before future official distribution relies on these built-in IDs.
- TUI menus use arrow keys and Enter. Back uses Esc. Quit uses q. Letter aliases do not select menu items.
- Tests must cover observable behavior, target precedence, secret boundaries, and failure before side effects.
- Do not hand-edit generated files.

## Evidence and Decisions

- VERIFIED: Before this change, `apps/cli/src/auth/config.ts` fell back to generic/unregistered `sokosumi_cli` for hosted targets when no target-specific or generic override existed.
- VERIFIED: `apps/cli/.env` contains target OAuth client IDs, and the CLI now loads local `.env` values below explicit process environment values.
- VERIFIED: Before this change, running the built CLI without a loaded client ID produced an OAuth flow ending at `error=invalid_client&error_description=client_id+is+required`.
- VERIFIED: `apps/cli/src/auth/secure-store.ts` now keeps credential payloads out of macOS process arguments and sanitizes native vault errors. Commit `df3895398` contains that fix.
- VERIFIED: The sibling CLI writes an API key into `~/.sokosumi/config.json` and loads it as an environment value. That path is excluded from the port.
- REPORTED: The sibling advisor recommends one canonical `apps/cli` source, non-secret home preferences, and OS-vault secrets. The recommendation cites `apps/cli/SPEC.md`, `apps/cli/src/auth/secure-store.ts`, and the sibling `src/utils/env.mjs`.
- INFERRED: A standard-library `.env` parser is sufficient for the small set of CLI configuration keys and avoids adding a dependency for one file format.
- VERIFIED: Packaged CLI cannot depend on local `apps/cli/.env`; hosted defaults are registered target IDs (`GxmewjdHVAaqUEglxWdyCqVFvnTASycj` mainnet, `lqhckIfBGmFhBMyCkbhvUkXHiatZVXwR` preprod) and hosted auth derives from selected Core API URL + `/auth`.
- REPORTED: User reports both mainnet and preprod CLI OAuth succeed, including successful preprod authorization-code token exchange after fixing wrong preprod `BETTER_AUTH_SECRET` that caused JWK token verification failure. Cause and fix are not independently verified in this repository; SOK-1040 tracks the reported Core issue.
- REPORTED: On 2026-09-11, user deleted the npm `sokosumi` release/package and deferred publication to the official Masumi Network account. Current CLI scope is source-only.
- VERIFIED: V47 redaction coverage in `apps/cli/src/error-redaction.ts` and `apps/cli/test/api/http-client.test.ts` recursively removes credential-shaped fields across casing, separators, nesting, and serialized Core errors.
- VERIFIED: V63 coverage extends redaction to credential-shaped `key=value` pairs inside nested strings, including Core API errors and discover JSON; secret values are absent from rendered/serialized output.

## File Map

- `apps/cli/src/config/loader.ts`: Read non-secret home preferences and local `.env` values. Merge them below explicit process environment values.
- `apps/cli/test/config/loader.test.ts`: Prove precedence, target keys, and the exclusion of secret fields.
- `apps/cli/src/auth/config.ts`: Resolve target URLs and OAuth IDs from the merged environment. Hosted targets use the first-party client by default.
- `apps/cli/src/cli/index.ts`: Load configuration before command dispatch and retain flag-over-environment precedence, including the explicit client ID passed to the TUI.
- `apps/cli/src/cli/auth-login.ts`: Use the resolved public client ID when calling `loginWithBrowser`.
- `apps/cli/src/tui/select-input.ts`: Shared arrow-key and Enter selector for Ink screens.
- `apps/cli/src/tui/status-app.ts`: Replace numeric and letter menu aliases with selectors and clear navigation help.
- `apps/cli/src/tui/resource-view.ts`: Read-only Dashboard, Agents, Coworkers, Tasks, Jobs, and Account views.
- `apps/cli/src/api/http-client.ts`: Typed Core HTTP transport with explicit auth precedence and redacted errors.
- `apps/cli/src/api/models/*.ts`: Typed, tolerant Core DTO models for agents, coworkers, tasks, jobs, categories, users, and response envelopes.
- `apps/cli/src/api/services/*.ts`: Core route adapters copied once from the sibling behavior, with typed inputs and outputs.
- `apps/cli/src/cli/commands/*.ts`: Headless command handlers for discovery, agents, coworkers, tasks, and jobs.
- `apps/cli/skills/<name>/SKILL.md`: Canonical headless workflows and focused Sokosumi skill entry points.
- `apps/cli/src/cli/index.ts`: Register command handlers and keep global option parsing in one place.
- `apps/cli/test/config/*.test.ts`, `apps/cli/test/api/*.test.ts`, `apps/cli/test/cli/*.test.ts`: Behavior tests colocated with the relevant slice.
- `apps/cli/README.md`: Document canonical ownership, config file shape, OAuth client setup, and secret storage after code behavior is verified.

## Task 1: Load non-secret configuration

**Files:** Create `apps/cli/src/config/loader.ts` and `apps/cli/test/config/loader.test.ts`. Modify `apps/cli/src/cli/index.ts` and `apps/cli/src/auth/config.ts`.

**Interface:**

```ts
export interface CliPreferences {
  apiUrl?: string;
  authUrl?: string;
  webUrl?: string;
  mainnetOAuthClientId?: string;
  preprodOAuthClientId?: string;
}

export interface CliConfigLoadOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  cwd?: string;
  homeDir?: string;
  loadFiles?: boolean;
}

export function loadCliEnvironment(options?: CliConfigLoadOptions): Record<string, string | undefined>;
```

**Steps:**

- [x] Read `~/.sokosumi/config.json` as JSON and accept only the non-secret URL and OAuth client ID fields.
- [x] Ignore `apiKey`, `authToken`, `accessToken`, `refreshToken`, `clientSecret`, and unknown fields.
- [x] Read `.env` from the current directory and the package root when present. Parse `KEY=value`, quoted values, blank lines, and comments. Do not log values.
- [x] Merge values in this order: package/local `.env`, home preferences, explicit environment. Keep an injected environment and `loadFiles: false` deterministic in tests.
- [x] Map preferences to `SOKOSUMI_*` keys used by the existing resolver.
- [x] Call the loader once before global flags are applied. Do not mutate `process.env`.
- [x] Test that explicit environment wins, home preferences win over `.env`, and secrets in config never reach the returned environment.

- **Verification:** `pnpm --filter ./apps/cli test -- test/config/loader.test.ts`.

## Task 2: Fix hosted OAuth resolution

**Files:** Modify `apps/cli/src/auth/config.ts`, `apps/cli/src/cli/auth-login.ts`, `apps/cli/src/cli/index.ts`, and `apps/cli/src/tui/status-app.ts`. Extend `apps/cli/test/cli/auth-login.test.ts`, `apps/cli/test/cli/index.test.ts`, and `apps/cli/test/tui/status-app.test.ts`.

**Interface:** `resolveCliConfig()` continues returning `CliTargetConfig`. `clientId` defaults to the registered target ID (`GxmewjdHVAaqUEglxWdyCqVFvnTASycj` mainnet, `lqhckIfBGmFhBMyCkbhvUkXHiatZVXwR` preprod); explicit `--client-id`, target-specific environment values, and generic `SOKOSUMI_OAUTH_CLIENT_ID` override it. Hosted `authBaseUrl` defaults to selected API URL + `/auth`; custom `authUrl` remains scoped to custom targets.

**Steps:**

- [x] Preserve flag precedence for `--client-id` and target-specific environment precedence.
- [x] Use `SOKOSUMI_MAINNET_OAUTH_CLIENT_ID` for mainnet and `SOKOSUMI_PREPROD_OAUTH_CLIENT_ID` for preprod as optional overrides.
- [x] Use built-in registered target IDs (`GxmewjdHVAaqUEglxWdyCqVFvnTASycj` mainnet, `lqhckIfBGmFhBMyCkbhvUkXHiatZVXwR` preprod) when no override exists; packaged CLI must not require local `.env`.
- [x] Derive hosted auth base from selected API URL + `/auth`; keep custom `authUrl` override scoped to custom targets.
- [x] Preserve an explicit `--client-id` when the TUI changes hosted targets.
- [x] Add tests that hosted OAuth uses each registered target ID without configuration and that explicit overrides reach target selection.
- [x] Keep API-key login independent of OAuth client ID availability.

- **Verification:** `pnpm --filter ./apps/cli test -- test/cli/auth-login.test.ts test/cli/index.test.ts`.

## Task 3: Replace confusing TUI aliases

**Files:** Create `apps/cli/src/tui/select-input.ts` and `apps/cli/test/tui/select-input.test.ts`. Modify `apps/cli/src/tui/status-app.ts` and its tests if present.

**Interface:**

```ts
export interface SelectItem<T> {
  value: T;
  label: string;
}

export function SelectInput<T>(props: {
  items: readonly SelectItem<T>[];
  onSelect: (value: T) => void;
  initialIndex?: number;
  listen?: boolean;
}): React.ReactElement;
```

**Steps:**

- [x] Render one selected row with a visible pointer and plain labels.
- [x] Move with Up and Down, wrapping at the list edges.
- [x] Select only on Enter. Do not treat `o`, `a`, `1`, `2`, `r`, or `x` as menu commands.
- [x] Use Esc for back inside nested screens and q for quit through the app-level handler.
- [x] Replace auth method, OAuth target, API-key target, signed-in home, and Coworker preset screens with selectors.
- [x] Render `Use arrows, then Enter`, `Esc back`, and `q quit` so the interaction is visible.
- [x] Keep raw API-key input on stdin and preserve hidden input behavior.
- [x] Test selection state transitions with a pure helper or Ink test harness. The test must prove an old letter alias does not select a menu option.

- **Verification:** `pnpm --filter ./apps/cli test -- test/tui/select-input.test.ts` plus a built TUI smoke run.

## Task 4: Port Core transport and models

**Files:** Create `apps/cli/src/api/http-client.ts`, `apps/cli/src/api/models/*.ts`, `apps/cli/src/api/services/*.ts`, and focused tests under `apps/cli/test/api/`.

**Interface:**

```ts
export interface HttpClientOptions {
  apiUrl: string;
  authManager: AuthManager;
  authToken?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export function createHttpClient(options: HttpClientOptions): {
  get<T>(pathname: string): Promise<T>;
  post<T>(pathname: string, body: unknown): Promise<T>;
  patch<T>(pathname: string, body: unknown): Promise<T>;
  delete<T>(pathname: string): Promise<T>;
};
```

**Steps:**

- [x] Port explicit bearer precedence, explicit user API-key precedence, stored OAuth, then configured API-key fallback.
- [x] Read Core response envelopes without assuming every response has a non-null data field.
- [x] Preserve HTTP status and parsed error body while excluding authorization values from thrown messages.
- [x] Port tolerant model constructors for agent, coworker, task, job, category, user, and nested output/event records.
- [x] Port service paths after checking the matching Core route mounts in `apps/core/src/routes/v1/index.ts`.
- [x] Add transport tests for auth precedence, JSON parsing, status errors, and secret redaction.

- **Verification:** `pnpm --filter ./apps/cli test -- test/api`.

## Task 5: Port headless command slices

**Files:** Create `apps/cli/src/cli/commands/*.ts` and tests under `apps/cli/test/cli/commands/`. Modify `apps/cli/src/cli/index.ts` and help text.

**Commands:** `discover`, `agents list`, `agents hire`, `coworkers list`, `coworkers register`, `coworkers update`, `coworkers api-key`, `coworkers me`, `tasks list`, `tasks create`, `tasks get`, `tasks events`, `tasks jobs`, `tasks comment`, `jobs list`, `jobs get`, and `jobs input`.

**Steps:**

- [x] Port the sibling's JSON and text output contracts without copying its plaintext config or secret-bearing argv behavior.
- [x] Support `--json` on every command.
- [x] Support search and positive limit filters for list commands.
- [x] Accept API-key input only through the existing environment or stdin path. Do not add `--api-key`.
- [x] Keep command handlers independent from the Ink TUI so headless use never opens a browser or terminal menu.
- [x] Test one success and one validation or Core error path per command family. Assert output fields, not implementation details.
- [x] Add the complete command catalog to help and discovery output.
- [x] Match Core coworker create schema by requiring `--vendor-id` and emitting `vendorId`.

- **Verification:** `pnpm --filter ./apps/cli test -- test/cli/commands`.

## Task 6: Port useful views and finish canonical ownership

**Files:** Create or modify `apps/cli/src/tui/` views, `apps/cli/README.md`, `apps/cli/skills/`, and package tests. Do not modify `/Volumes/Sarthi MAC/Soko/sokosumi-cli` product source.

**Steps:**

- [x] Port dashboard, agent, Coworker, task, job, and account views only when their Core command slice is present.
- [x] Reuse the shared selector and text input components. Do not reintroduce letter-alias menus.
- [x] Keep resource views read-only; job input-request submission remains a headless command/API follow-up.
- [x] Document that `apps/cli` is canonical and the sibling repository is not a second source.
- [x] Document the exact non-secret config JSON keys and target-scoped vault behavior.
- [x] Keep private workspace package identity sokosumi, package path apps/cli, and binary sokosumi.
- [x] Update `apps/cli/SPEC.md` task status through the spec workflow after the corresponding behavior was verified.

**Verification:** `pnpm --filter ./apps/cli test && pnpm --filter ./apps/cli typecheck && pnpm --filter ./apps/cli build`.

## Task 7: Retired npm-global CLI auto-update

**Correction (2026-09-11):** REPORTED: User deleted the npm sokosumi release/package and deferred publication to the official Masumi Network account. Current CLI scope is source-only.

**Status:** Retired. The source-only CLI does not query the npm registry, spawn a package manager for updates, show an updater prompt, or include updater tests. Future official distribution will define update behavior.

**Verification:**

- VERIFIED: The updater source and prompt files, plus their tests, are deleted from the current working tree.
- VERIFIED: pnpm --dir apps/cli test → 146 tests, 146 passed, 0 failed.


## Task 8: Redesign Ink TUI against sokosumi-tui-v1.html

**Goal:** Make the v1 design bundle the primary visual source for the sign-in flow and signed-in terminal workspace while preserving real CLI behavior.
**Reference (REPORTED):** Primary, user-provided external bundle at `~/Desktop/I-Want-You-Desing-Tui-Sokosumi/`: `sokosumi-tui-v1.html` (primary screen), `DESIGN-HANDOFF.md` (visual contract), `DESIGN-MANIFEST.json` (v1 screen and required state coverage), and `brand-spec.md` (palette, type, and identity rules). These files are external design references, not runtime assets. Existing `~/Desktop/sokosumi-tui.html` remains a secondary flow reference.

**Files:** Primarily modify `apps/cli/src/tui/status-app.ts`, `apps/cli/src/tui/select-input.ts`, and `apps/cli/src/tui/resource-view.ts`. Extend `apps/cli/test/tui/status-app.test.ts` and `apps/cli/test/tui/select-input.test.ts` as needed. Do not add HTML/CSS or a second UI implementation.

**Contracts preserved:** Ink/React only; arrows + Enter; Esc back; q quit; real Core HTTP data through existing services; OAuth/API-key behavior and auth/secret boundaries unchanged; headless commands untouched; no fake/demo data or copied prototype fixtures; no browser `localStorage` behavior; no direct database access; exact pinned dependencies; preserve SPEC V13/V20 identity and keyboard rules.

**V1 visual facts:**

- Dark bordered terminal frame with titlebar and statusbar; a single mono type family; named dark background, surface, foreground, muted, border, accent, and low-chroma state tokens.
- Centered ASCII-logo sign-in with method, target, confirm, and key-input states.
- Signed-in workspace with desktop horizontal navigation tabs and a content pane; narrow terminal widths adapt without horizontal overflow, with a pane prompt.
- Dashboard summary/activity; resource list/detail rows; Register a Coworker, Account, and Sign out.
- Visible selection/focus plus required `default`, `hover`, `focus`, `active`, `disabled`, `loading`, `empty`, `error`, and `success` states.
- Chats/Channels appear only when existing Core service/model contracts back their data; do not copy prototype demo data or browser `localStorage` behavior.
- [x] Signed-in navigation keeps Register as a preset-only tab and marks both the tab and Register pane with muted `(soon)` text; focused TUI tests and current source verify the navigation behavior is unchanged.
- [x] Source-derived TUI values are covered by tests: `apps/cli/src/cli/metadata.ts` loads package `name`/`version` for `CLI_PACKAGE_NAME`/`CLI_VERSION`; API-key prefixes are `soko_mainnet_` and `soko_preprod_`; the creation route is `/connections`; the default OAuth callback is `http://127.0.0.1:53682/oauth/callback`.
- [x] `TUI_THEME` is shared by the TUI resource, selector, status, and updater views: `black`, `blackBright`, `white`, `gray`, `gray`, `cyan`, `green`, `yellow`, `red` for background, surface, foreground, muted, border, accent, success, warning, and error.
- [x] The Ink updater screen renders `Update now` and `Continue without updating`, accepts arrows + Enter and `y`/`n`, and maps Esc, `q`, and Ctrl+C to continue without updating.
- [x] The updater callback accepts `render`, `stdin`, and `stdout`; Ink is configured with `exitOnCtrlC: false` and `patchConsole: false`.
- [ ] Hover and disabled visual states are design requirements, not verified implementation evidence.

**Actionable steps:**

- [ ] Extract and freeze the v1 named token map, single mono type, terminal chrome, pane prompt, and width-safe layout rules for the dark bordered frame, titlebar, and statusbar.
- [ ] Port the centered ASCII-logo sign-in through method, target, confirm, and key-input states while preserving existing OAuth/API-key and auth transitions.
- [ ] Port the signed-in desktop tab workspace and dashboard: horizontal navigation tabs, content pane, summary/activity, and narrow-terminal adaptation without horizontal overflow.
- [ ] Port resource list/detail rows and Register a Coworker, Account, and Sign out states with visible selection/focus and all required `default`, `hover`, `focus`, `active`, `disabled`, `loading`, `empty`, `error`, and `success` variants; use live Core data and add Chats/Channels only when existing contracts support them.
- [ ] Verify the built Ink CLI in a PTY at narrow and wide terminal widths plus keyboard flows through sign-in, tabs/workspace, resources, register, account, and sign-out using arrows + Enter, Esc back, and q quit.

**Verification:**

- `pnpm --filter ./apps/cli test`
- `pnpm --filter ./apps/cli typecheck`
- `pnpm --filter ./apps/cli build`
- `pnpm check`
- Built PTY smoke of the sign-in, tab/workspace, dashboard, resource, register, account, and sign-out flows at narrow and wide terminal widths, including keyboard transitions and no horizontal overflow.

**Pending verification:**

- [ ] V1 visual parity against primary `sokosumi-tui-v1.html` and `DESIGN-HANDOFF.md`: terminal chrome, sign-in states, tab workspace/content pane, dashboard, resource rows, register/account/sign-out, selection/focus, and all required state variants.
- [ ] Token/type fidelity: `DESIGN-MANIFEST.json` named tokens and `brand-spec.md` single mono type, dark palette, low-chroma state colors, and SPEC V13/V20 identity are represented.
- [ ] Responsive terminal widths/no horizontal overflow: narrow and wide terminal PTYs adapt the v1 browser viewport matrix without clipped or horizontally scrolling content.
- [ ] Keyboard transitions: arrows + Enter, Esc back, and q quit work across sign-in, tabs/workspace, list/detail, register, account, and sign-out states.
- [ ] Real data/no prototype fixtures: dashboard and resource panes use existing Core HTTP services/models; no copied demo data, browser `localStorage`, direct database access, or changed auth/secret boundary; Chats/Channels remain conditional on existing contracts.
- [x] Full CLI test suite: 146 tests, 146 passed, 0 failed.
- [x] CLI Biome check: Checked 70 files in 36ms. No fixes applied.
- [x] CLI typecheck.
- [x] CLI build; verified built CLI version: 2.1.4.
- [ ] pnpm typecheck (fails only in unrelated web#typecheck; CLI typecheck passed).
- [x] Built sign-in PTYs exercised at 40x20 and 100x30.
- [x] Signed-in Register fixture PTY at 120x40 captured Register (soon) and / register (soon) with no overflow.
- [x] Fixture/JSON evidence: local fixture API flow and headless JSON command checks passed.
- [x] Confirm no CLI source imports @sokosumi/database or writes secrets to ~/.sokosumi/config.json.
- [x] Confirm the sibling repository has no product-source edits.
- [x] Package is private; npm publication and published-package smoke are retired from the current source-only scope.
- [ ] Hosted OAuth gate remains pending: verify mainnet/preprod clients use public-native registration with canonical `redirect_uris=["http://127.0.0.1/oauth/callback"]`, then complete real authorization-code exchanges; not independently verified here.
- [ ] Full workspace-flow gate remains pending; broad visual parity, responsive layout, hover/disabled states, and complete keyboard flow coverage remain unverified.
- [ ] OAuth/release gate: verify native-client registration/path and real authorization-code exchanges using runtime `http://127.0.0.1:53682/oauth/callback`; port `53682` valid under RFC 8252 §7.3, not a SPEC mismatch.

## Least confident decisions

1. The standard-library `.env` parser may need one additional escaping rule if real deployment files use multiline or export-prefixed values.
2. Resource views remain read-only. Input-request submission stays headless until a tested interactive flow exists.
3. Registered hosted clients `GxmewjdHVAaqUEglxWdyCqVFvnTASycj` (mainnet) and `lqhckIfBGmFhBMyCkbhvUkXHiatZVXwR` (preprod) plus hourly repair route must run in both hosted environments before the published CLI relies on built-in defaults. Hosted OAuth remains pending and unverified in this repository; line 35 preserves the separate user-reported success claim.
4. The v1 browser viewport matrix and responsive/layout details require translation into terminal widths; existing Core support may not cover Chats/Channels, so decide when those surfaces are supported from the existing contracts and omit them otherwise.
