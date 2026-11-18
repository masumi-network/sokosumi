# Sokosumi Web App Agent Guidelines

> **Purpose**: This document provides app-specific guidelines for AI agents working on the Sokosumi web application. For comprehensive monorepo guidelines, see the [root AGENTS.md](../../AGENTS.md).

## App-Specific Architecture

**Framework**: Next.js 16 App Router with React 19.3 Server Components
**Location**: `apps/web/` directory within the pnpm workspace
**Key Directories**: The live tree is `src/`. Conventions that still match: `src/app/` (routes), `src/components/` (Shadcn + Radix), `src/lib/` (three-layer services/actions/utils, including `src/lib/auth/`), `src/hooks/`, `src/contexts/`. Also `src/config/`, `src/i18n/`, `src/queries/`, `src/middleware/` (auth helpers). The Next.js 16 request interceptor is `src/proxy.ts` (`export async function proxy`), not `middleware.ts`.

Outside `src/`: `agents/image-studio/` is the Project image studio's eve agent. `withEve()` in `next.config.ts` builds it as a service inside this deployment at `/eve/image-studio/v1/*`, so its model credential and its Core origin are this project's environment. See [image studio deployment](../../docs/image-studio/deployment.md).

## App Router Structure

The live tree is `src/app/`. `(app)` is protected. `(auth)` is public auth. `(flows)` is invitations and setup. Also `api/`, `auth/` (OAuth `apple`, `callback`, `error`), `share/`, `(app)/tasks`, `maintenance`.

`@/app/*` resolves to `src/app/(app)/*` (`tsconfig.json`), so `@/app/tasks/...` lives in `src/app/(app)/tasks/...`. Other route groups have no alias; open them by their `src/app/(group)/` path.

**Auth flow entry points** (sign-in, sign-up, codes, captcha):

- Web: `src/app/(auth)/components/auth-flow.tsx` drives every step; `email-step.tsx` and `use-email-code.ts` beside it. `src/lib/utils/last-used-auth-method.ts` (`chooseSignInMethod`) picks password vs code. Captcha is `src/components/auth-captcha.tsx`; re-auth is `src/components/auth/reauth-dialog.tsx`.
- Core: `apps/core/src/lib/auth.ts` wires Better Auth; its plugins sit beside it as `auth-*.ts` (`auth-captcha.ts`, `auth-email-code-sign-in.ts`, `auth-sign-up-email-status.ts`).
- Intended behaviour: [ADR 0049](../../docs/adr/0049-email-codes-replace-magic-links.md), [ADR 0050](../../docs/adr/0050-password-sign-up-proves-the-address.md), and the sign-in walkthrough in [`.cursor/skills/verify-sokosumi/features/sign-in.md`](../../.cursor/skills/verify-sokosumi/features/sign-in.md).
- Better Auth source: read `apps/core/node_modules/better-auth/dist/`. `require.resolve('better-auth/package.json')` fails because the package does not export it.
- Identity onboarding (first workspace) is `src/app/(flows)/setup/`.

## App-Specific Conventions

### Server Components First

- Default to Server Components for all new components
- Use `'use client'` only when accessing browser APIs
- Leverage server actions for mutations instead of client-side state

**Never import a plain value (a string, array, or object constant) from a `'use client'`
module into a Server Component.** Components cross that boundary; values do not — the
import resolves to a client reference, not the value, and fails silently. The sidebar's
row-shape classes lost this way: `cn(SIDEBAR_ROW_CLASS, …)` returned `""` in the shell
skeleton, so every placeholder row rendered as a bare block with no flex, height or
padding, while the same constants worked in the client list beside it. Shared constants
belong in their own non-client module (`src/components/ui/sidebar-classes.ts` beside
`sidebar.tsx`), imported by both sides.

### Server actions vs Route Handlers

Next.js serializes concurrent **server actions** per session. A long action started in the background (for example catalog pre-warm on mount) can delay unrelated user actions on the same page (for example OAuth start).

- Prefer **server actions** for mutations and explicit user-triggered work.
- For **background or pre-warm reads** that must not contend with other actions, use a session-authenticated **Route Handler** under `src/app/api/` and `fetch` from the client (cookies / `credentials: "same-origin"`).
- Share server-side load logic in `src/lib/services/` so Route Handlers and future callers stay in sync.
- Do **not** fire long server actions on mount of a hidden multi-step UI while later steps still call actions.

### Server action Results (neverthrow + wire DTO)

**In-process** error handling always uses `neverthrow` (`ok` / `err` / `Result`). See root [neverthrow rule](../../.cursor/rules/neverthrow.mdc).

**Do not use `@/lib/ts-res`.** That helper (`Ok` / `Err` / `result.data`) was removed (SOK-768). Never reintroduce it.

**Server action returns** must be the plain serializable DTO — neverthrow class methods do not survive Flight. Success and error payloads (`T` / `E`) must themselves be plain JSON/Flight-safe values.

```typescript
import { ok, err, type Result } from "neverthrow";
import {
  toActionResult,
  type ActionResultDto,
} from "@/lib/actions/action-result";

// wire: { ok: true; value: T } | { ok: false; error: E }
export async function exampleAction(): Promise<
  ActionResultDto<{ id: string }, ActionError>
> {
  const result: Result<{ id: string }, ActionError> = ok({ id: "…" });
  return toActionResult(result);
}
```

**Clients** (after the action returns — not neverthrow methods):

```typescript
const result = await exampleAction();
if (!result.ok) {
  // result.error
  return;
}
// result.value — never result.data (that was @/lib/ts-res)
```

Prefer `toActionResult` over inventing another Ok/Err helper.

### Route Organization

- Group related routes using parentheses: `(app)`, `(auth)`
- Use parallel routes for complex layouts
- Implement proper loading and error boundaries
- **Error boundaries see only `digest` in production.** A production build delivers a server error to a client boundary as a generic `Error`, without its name, message or custom fields. Match a stable digest set on the error (`UNAUTHENTICATED_ERROR_DIGEST` in `src/lib/auth/errors.ts`), not `error.name`. In a test, mask the error first (a new `Error` with only the digest copied); a test that builds the error class directly passes against a boundary that fails in production.

### Component Patterns

- Use Shadcn UI components from `src/components/ui/`
- Adding a shadcn component or block: load [shadcn-add](.agents/skills/shadcn-add/SKILL.md); upstream classes break our guards until adapted
- Implement responsive design with Tailwind CSS
- Follow the established component structure pattern

### useEffect and client-side effects

Use Effects only to **synchronize with external systems** (browser APIs, third-party widgets). Avoid Effects for derived state, user events, or mirroring props/state—dependency arrays hide coupling and effect chains are hard to trace.

- **Do not use Effects for**: derived state (compute during render), filtering lists (derive or `useMemo`), resetting state on prop change (use `key` to remount), user events (use event handlers), data fetching (use `@tanstack/react-query`), chains of state updates, notifying parent (use handler or lift state).
- **Smell tests**: State used as a flag so an effect can “do the real action” → use the event handler. Effect that only resets when an ID/prop changes → use `key` and remount.
- **Mount-only sync**: For “run once on mount, cleanup on unmount” (DOM focus, third-party widget, browser API), use a named hook such as `useMountEffect(effect)` (i.e. `useEffect(effect, [])`) so intent is explicit. Prefer conditional mounting: don’t mount the child until preconditions are met, then the child can use the mount-only hook.
- **Do use Effects for**: mount-only external sync (via `useMountEffect`), external store subscriptions (`useSyncExternalStore` when applicable), syncing with non-React systems. For fetching that must stay in sync with props and a library isn’t feasible, use Effects only with proper cleanup to avoid race conditions.

See [.cursor/rules/effects.mdc](.cursor/rules/effects.mdc) for examples and references (react.dev, Factory “Why we banned useEffect”).

### Linting & Formatting

The web app uses the shared Biome configuration from the repo root. See [shared code conventions](../../docs/agents/coding-conventions.md#linting--formatting) for base rules.

- `pnpm --filter web check` runs `biome check`, so it enforces linting, formatting, and import organization
- `pnpm --filter web check:write` applies Biome fixes, including import organization
- `pnpm --filter web lint` runs `biome lint`, so it checks lint rules only
- Some older ESLint-only rules were intentionally removed during the Biome migration and are now conventions rather than enforced diagnostics

#### Environment Variables

Do not read `process.env` directly in web app code.

- **Status**: This is a repository convention and code review rule; it is no longer enforced by the formatter/linter.
- **Fix**: Use typed config functions:
  - `getEnvSecrets()` - for sensitive variables (API keys, database URLs)
  - `getEnvPublicConfig()` - for public configuration (feature flags, URLs)

**Example**:

```typescript
// ❌ Wrong
const apiKey = process.env.API_KEY;

// ✅ Correct - type-safe and validated
import { getEnvSecrets } from "@/config/env.secrets";
import { getEnvPublicConfig } from "@/config/env.public";
const apiKey = getEnvSecrets().API_KEY;
const appUrl = getEnvPublicConfig().NEXT_PUBLIC_SOKOSUMI_URL;
```

#### Import Paths

- **No relative imports** across directories
- Same-folder relative imports are allowed: `import { helper } from "./helper"`
- Use `@/` alias for all cross-directory imports
- For App Router modules, always import via `@/app/<subpath>` and never `src/app/(app)` in import paths

**Examples**:

```typescript
// ✅ Correct
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/services/user";
import { JobsList } from "@/app/agents/[agentId]/jobs/components/jobs-list";
import { helper } from "./helper"; // same folder

// ❌ Wrong
import { Button } from "../../components/ui/button";
import { getUser } from "../services/user";
import { JobsList } from "src/app/(app)/agents/[agentId]/jobs/components/jobs-list";
```

**Fix**: Convert cross-directory imports to absolute paths with `@/`

#### Next.js Specific

- Use Next.js `<Link>` component for internal navigation
- Never use `<a>` tags for page navigation
- Optimize images with `<Image>` component

- **Status**: This remains the expected project convention, but it is not currently enforced by Biome

#### Internationalization (next-intl)

- All user-facing text requires translation keys
- Use `useTranslations()` hook in components
- Add new keys to `messages/en.json`

- **Status**: This remains the expected project convention, but it is not currently enforced by Biome

## App-Specific Commands

| Command                    | Purpose                                                                     |
| -------------------------- | --------------------------------------------------------------------------- |
| `pnpm web:dev`             | Start development server on `:3000`                                         |
| `pnpm portless:dev`        | Web + Core via portless (repo root; named `https://web.sokosumi.localhost`) |
| `pnpm portless:web`        | Web only via portless (still injects Core's named URL)                      |
| `pnpm web:build`           | Build for production                                                        |
| `pnpm web:start`           | Test production build                                                       |
| `pnpm --filter web lint`   | Run Biome lint rules for the web app                                        |
| `pnpm --filter web check`  | Run full Biome checks for the web app                                       |
| `pnpm web:test`            | Run web app tests                                                           |
| `pnpm --filter web format` | Format code with Biome                                                      |

## App-Specific Testing

- Place `foo.test.ts(x)` next to `foo.ts(x)`. Use `__tests__/` only for tests that do not map 1:1 to a source file (contracts, harnesses, fixtures)
- Mock external APIs with colocated `vi.mock` (there is no `__mocks__/` directory)
- Test both server and client components appropriately
- Use Testing Library for component testing
- **cmdk rows** (`@/components/ui/command`): every `CommandItem` carries `data-disabled` and `aria-disabled` as `"true"` or `"false"`, so assert the value (`toHaveAttribute("aria-disabled", "true")`), never the attribute's presence. A row with a `CommandShortcut` has the digit in its accessible name (`"Queued 2"`): match it by prefix (`{ name: /^Queued/ }`). Stub `Element.prototype.scrollIntoView = vi.fn()`, which happy-dom lacks and cmdk calls.
- **Stale typecheck**: `tsconfig.json` is incremental. Before calling a type error pre-existing on `main`, delete `tsconfig.tsbuildinfo` or run `tsc --noEmit --incremental false`; an old build-info file keeps reporting errors a fix removed.
- **Second click on a busy button**: a `Button` with `loading` drops clicks (`preventActivation` in `src/components/ui/button.tsx`). State set after an `await` in an async transition renders before `isPending` clears, so a test that waits for the result and clicks again fails at random. Wait until the control is idle first: `aria-busy` gone, or `toBeEnabled()`.
- **`Notification` stubs**: `isPushSupported()` needs `Notification.requestPermission` to be a function (`src/lib/utils/browser-notification.ts`). A stub with only `permission` makes push code return early, so the test passes on any code. Stub both: `Object.assign(function Notification() {}, { permission, requestPermission: async () => permission })`.

### Test files share a worker

`vitest.config.mts` sets `isolate: false` and shuffles file order. Each file inherits whatever the file before it left in the worker: one happy-dom window (its cookies, document and DOM prototypes) and every dependency loaded from `node_modules` (React, react-dom, Testing Library, `js.foresight`). A leak fails some other file, at random. The setup files undo what they can after each file; leave the rest as you found it:

- **Globals.** Use `vi.stubGlobal("fetch", mock)`, never `window.fetch = mock`, `global.fetch = mock` or `Object.assign(window, …)`. In the happy-dom project a plain assignment to a window property is kept where nothing can undo it, so the next file gets your mock. `src/test/setup.ts` calls `vi.unstubAllGlobals()` and `vi.unstubAllEnvs()` after each file, and puts back any existing global a file redefined (`Object.defineProperty(window, "location", …)`).
- **Document, prototypes and browser state.** `src/test/setup.dom.ts` puts back the document's own properties (`document.cookie`, `visibilityState`, `execCommand`) and DOM prototypes (`Element.prototype.scrollIntoView = vi.fn()`). It also clears cookies and the document and resets the URL and viewport. Each file gets fresh `localStorage` and `sessionStorage`, because a `vi.spyOn(localStorage, …)` never comes off happy-dom's storage. Restore a `happyDOM.settings` value you change.
- **Mocks, timers and module state.** `src/test/setup.ts` resets the module registry before each file, so `vi.mock` applies even when an earlier file imported the real module. After each file it calls `vi.useRealTimers()` and `vi.restoreAllMocks()`. A module's own state can still outlive it through a dependency that stays loaded: tie it to the module, not to the dependency (`src/hooks/use-intent-prefetch.ts` guards its listeners with its own flag, not with `ForesightManager.isInitiated`).
- **Pending React transitions.** react-dom joins every async transition to any that is still pending. A transition that awaits a promise that never settles keeps every later file's transitions pending. Do not leave such a promise behind: use `Promise.withResolvers()` and settle it in `act` before the test ends, and run out the timers a transition awaits. `src/test/setup.dom.ts` fails a file that leaves one: "left a React async transition pending".

### No unexpected console output

`src/test/setup.ts` fails a test that writes a `console.error` or `console.warn` it did not declare, and a test that replaces either (`vi.spyOn(console, "warn").mockImplementation(…)`, `console.warn = fn`, a bare `vi.fn()`), even one restored before the test ends. `console.log` stays allowed. Such output means the test ran something other than production. Fix the cause:

- a mock missing an export, or one that answers `undefined` where the real one answers data (`Query data cannot be undefined`);
- a fixture production would not send (two items with one key, a notification without its workspace);
- a hand-written `next-intl` setup without the app's `createFormats()` or with a stale message subset;
- a server action or service running inside a DOM test;
- a render that suspends without an awaited `act`.

`next/image` cannot measure a `fill` parent in happy-dom; mock it with `vi.mock("next/image", () => import("@/test/next-image"))`.

Only a test whose subject is that error path declares it, with `expectConsole(method, start, times = 1)` from `@sokosumi/utils/test-console`: the message must start with `start` and come exactly `times` times, and the return value holds the matched calls' arguments, so assert the reason or error on them.

**Reproduce an order.** The log's first line prints `Running tests with seed "<seed>"`. Rerun that order with `pnpm --filter web exec vitest run --sequence.seed=<seed>`. Adding `--maxWorkers=1` puts every file in one worker, which brings out leaks a 4-worker run only hits now and then. A failure that only shows up under one seed is a leak: find the earlier file that causes it and fix it there. Never retry it, skip it or give it a wider timeout.

## App-Specific Gotchas

### Authentication

- Routes under `(auth)/` are public
- Routes under `(app)/` require authentication

### Internationalization

- All user-facing text must use `next-intl`
- Translation keys in `messages/en.json`
- Use `useTranslations` hook in components
- **Locale-safe formatting in client components**: never use bare `.toLocaleString()` or default-locale `Intl.*` for numbers/dates in `'use client'` code — Node and the browser can format differently and cause hydration errors. Use `useFormatter().number()` / `useFormatter().dateTime()` in client components and `getFormatter()` in server components. See [.cursor/rules/i18n-formatting.mdc](.cursor/rules/i18n-formatting.mdc).
- `messages/en.json` is the source-of-truth catalog for the web app
- Supported locales: `en`, `de`, `es` — keep exact key-path parity (`pnpm --filter web messages:parity`)
- When a key is added, removed, renamed, or moved in `messages/en.json`, apply the same path change to every supported locale file in the same change
- If a translated value is not available yet, temporarily copy the English string so the key exists in every locale file
- **Client message bags**: route layouts nest `ClientMessageBoundary` (`src/i18n/`) so the client provider only receives a picked subset (`GLOBAL` / `AUTH` / `APP` / nested `SOKO_BOT`|`ADMIN` / `SHARE`). Server `getTranslations` still sees the full catalog from `request.ts`. Add new client namespaces to the owning bag in `message-namespaces.ts`.

### Database Access

- **Web does not access Postgres or Prisma.** All reads and writes go through the Core API (`coreClient` in `src/lib/clients/core.client.ts`).
- **Entity DTOs** (`Agent`, `Job`, `JobSummary`, `Task`, `OrganizationRecord`, …) come from the generated Core client (`@sokosumi/core-client`). Use `src/lib/types/core-dto.ts` for web helpers (`CoreAgentDto`, credit/rating accessors, placeholders) and enum **type** aliases derived from Core fields (`TaskStatus`, `JobType`, `SokosumiJobStatus`, …).
- **Enum runtime values** (`TaskStatus.RUNNING`, `JobType.PAID`, …) come from the generated Core client barrel (`@sokosumi/core-client`). Do not import domain enum values from `@sokosumi/utils`. **Pure helpers** (URLs, credits, locale, auth cookies, task-status transitions) stay in `@sokosumi/utils` — not entity mirrors. The drift test (`core-enums-drift.test.ts`) locks generated const shapes (and `SokosumiJobStatus` against the shared utils map).
- Codegen lives in `packages/core-client` so every app that calls Core imports one client. Subpaths: `@sokosumi/core-client/client` (`createClient`, `Client`), `/transformers`, `/schemas`.
- Do not import `@sokosumi/database` from web. Do not add Prisma/Core enum mirrors or Prisma-shaped composites under `@sokosumi/utils`.
- After adding or changing a Core endpoint, regenerate the Core API client (`pnpm --filter @sokosumi/core-client generate:snapshot`), then run `pnpm --filter web typecheck` (or `pnpm web:typecheck`). Do not chain typecheck into the generate script. Call regenerated endpoints from the web service layer. Services return Core DTOs directly — no mapper shims back to Prisma-shaped types.

#### Boundary rules (SOK-596)

Keep web on the Core DTO boundary (convention / review — not a separate CI grep job):

- **Never** import `@sokosumi/database` from web (including `package.json` dependencies).
- **Never** import domain enum **runtime const maps** from `@sokosumi/utils` — use `@sokosumi/core-client`. Forbidden names include: `TaskStatus`, `SokosumiJobStatus`, `JobType`, `AgentJobStatus`, `OnChainJobStatus`, `MemberRole`, `InvitationStatus`, `BlobStatus`, `NoticeKind`, `NotificationKind`, `Channel`.
- **Allowed** from utils: the approved pure helpers listed under [Core DTO boundary](#core-dto-boundary).
- **Allowlist:** `src/lib/clients/__tests__/core-enums-drift.test.ts` may import `SokosumiJobStatus` from `@sokosumi/utils` only (parity guard against the shared Core/DB map).
- After Core client regen, run `pnpm --filter web typecheck` (CI `typecheck` also covers this).

### Core DTO boundary

Generated Core `/v1` types are the source of truth for **entity** data web shows and mutates. Some shared symbols intentionally stay **outside** Core REST DTOs — do **not** promote them into OpenAPI entity schemas just to “finish” the Core DTO migration (SOK-588 phase 6).

#### In Core REST DTOs (use generated client)

- Entity shapes: `Agent`, `Job`, `JobSummary`, `Task`, `OrganizationRecord`, …
- Domain enum **types and runtime const maps** that appear in OpenAPI (e.g. `TaskStatus`, `JobType`, `OnChainJobStatus`, `MemberRole`, persisted `InvitationStatus`, `NotificationKind`, …) from `@sokosumi/core-client`
- Cross-cutting helpers / field-derived aliases in `src/lib/types/core-dto.ts`

#### Not Core REST DTOs (do not add to `/v1` OpenAPI entity schemas)

| Category                   | Examples                                             | Canonical home                                                                     | Rule                                                                                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stable API error kinds     | `CORE_API_ERROR_KINDS`, `CoreApiErrorKind`           | `@sokosumi/utils` (`packages/utils/src/core-api-error-kind.ts`)                    | Shared Core↔web error-envelope contract (`kind` on `CoreApiRequestError`). Match on these constants, never on human-readable `message`. Not an entity schema; keep as a shared const map.                                                                              |
| UI-only display values     | `expired` invitation status                          | Web: `InvitationDisplayStatus` in `src/lib/constants/invitation-display-status.ts` | Core/OpenAPI `InvitationStatus` is **DB-persisted only** (`pending` / `accepted` / `rejected` / `canceled`). `EXPIRED` is derived in the UI (pending + past expiry). Never add `EXPIRED` to the Core enum or OpenAPI schema. Use `InvitationDisplayStatus` for app UI. |
| Better Auth session shapes | `Session`, `SessionUser`, `SessionRecord`, `Account` | `@sokosumi/utils`                                                                  | Auth `/auth` protocol JSON, **not** `/v1` entity DTOs. Details in [Better Auth session types vs Core DTOs](#better-auth-session-types-vs-core-dtos) (SOK-593 / phase 5).                                                                                               |
| Localized view models      | `TaskWithCoworker`                                   | Feature folders next to UI                                                         | Thin UI joins only. Details in [View models vs Core DTOs](#view-models-vs-core-dtos).                                                                                                                                                                                  |

**Decision test:** If a value is (a) a stable error `kind`, (b) UI-derived display state, (c) Better Auth `/auth` shape, or (d) a feature-local view model — keep it out of Core REST entity DTOs. If more than one surface needs a **domain entity** field, push it to Core OpenAPI instead.

#### Approved `@sokosumi/utils` imports for web

Import **pure helpers** and the **documented exceptions** above from `@sokosumi/utils` directly (no passthrough re-export files). Approved categories:

1. **Auth session types** — `Session`, `SessionUser`, `SessionRecord`, `Account`
2. **Auth helpers** — `resolveBetterAuthCookieName`, `resolveBetterAuthCookiePrefix`, Better Auth public URL helpers, `betterAuthUserAdditionalFields` / `betterAuthOrganizationAdditionalFields`
3. **Error kinds** — `CORE_API_ERROR_KINDS`, `CoreApiErrorKind`
4. **Credits & billing vocabulary** — `convertCentsToCredits`, `convertCreditsToCents`, `isPositiveIntegerCredits`, credit top-up pricing helpers, `SelfServeSubscriptionPlanName` / `PaidSubscriptionPlanName` / `SubscriptionPlanName` / `OrganizationBillingPlanName` and their parsers, `FREE_SUBSCRIPTION_MONTHLY_CREDITS`, `hasStripeBillingAddressWithCountry`
5. **Locale** — `AppLocale`, `SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, `LOCALE_COOKIE_NAME`, `parseLocalePreference`, `resolveRequestLocale`, …
6. **URL / file / markdown** — `file-url` helpers (`getExtensionFromUrl`, `isImageUrl`, `isUrlString`, …), IPFS helpers (`resolveIpfsOrHttpUrl`, …), markdown link extract/escape, `sanitizeFileName`
7. **Metadata** — `getOrganizationMetadata`, `getUserMetadata`, `parseOrganizationMetadata` / `parseUserMetadata`, `buildOrganizationMetadataWith*` / `buildUserMetadataWith*`
8. **Task pure helpers** (status **logic**, not enum maps) — `userTaskStatusTransitionRequiresComment`, `isAgentOnlyTaskStatus`, `isTaskArchivableStatus`, `isTaskEditableStatus`, archive/editable status helpers
9. **Uploads & org logo** — user-upload content-type/path helpers, `ORGANIZATION_LOGO_*` constants
10. **Realtime / chat helpers** — Ably channel name builders, `isChatUiProviderReasoningPartType`, OpenRouter react-envelope helpers
11. **Other pure helpers** — user-name helpers, design-md attachment helpers, webhook helpers when needed

**Do not import from `@sokosumi/utils` in app code** (use generated Core instead):

- Domain enum **runtime const maps** that exist on Core OpenAPI — e.g. `TaskStatus`, `SokosumiJobStatus`, `JobType`, `AgentJobStatus`, `OnChainJobStatus`, `MemberRole`, persisted `InvitationStatus`, `BlobStatus`, `NoticeKind`, `NotificationKind`, `Channel`, …
- Prisma-shaped entity mirrors or database helpers (web never imports `@sokosumi/database`)

The drift test (`core-enums-drift.test.ts`) may import `SokosumiJobStatus` from utils as a parity guard — that is the only intended domain-enum exception in web.

### Better Auth session types vs Core DTOs

Better Auth session and account shapes are a **documented exception** under [Core DTO boundary](#core-dto-boundary) (SOK-588): they live in `@sokosumi/utils`, not in the generated Core REST client.

- **Canonical types** — `Session`, `SessionUser`, `SessionRecord`, and `Account` from `@sokosumi/utils` (`packages/utils/src/better-auth-types.ts`). Import them directly; do **not** add a Session-type passthrough (e.g. `@/lib/auth/session-types.ts`). Existing `@/lib/auth/types.ts` stays for `AccountProvider` only — do not turn it into a Session/Account re-export.
- **Protocol shapes, not entity DTOs** — These match Core Better Auth `/auth` JSON responses. They are **not** generated Core `/v1` entity DTOs (`Agent`, `Job`, `OrganizationRecord`, …).
- **Not Prisma models** — Do not confuse with `@sokosumi/database` `Session` / `Account` tables or Prisma-inferred row types.
- **Import rules** — Prefer `import type { Session, SessionUser, … } from "@sokosumi/utils"` everywhere (client/UI, services, tests). Do **not** add a type-only passthrough under `@/lib/auth/`.
- **Helpers vs fetch** — Cookie names, public URLs, and client schema helpers stay in `@sokosumi/utils` unchanged. Session **fetch** stays in web auth modules (`auth.client.ts`, `auth.server.ts`, `core-auth-http.server.ts`) → Core `/auth` only. There is no session-shaped Core REST display endpoint in this phase.

### View models vs Core DTOs

- **Services and actions return Core DTOs** (`Agent`, `JobSummary`, `Task`, `TaskListItem`, …). Do not invent a web-wide domain model layer that parallels Core shapes.
- **Thin view models are allowed only where UI needs computed or joined fields.** Keep them next to the consuming feature (e.g. `apps/web/src/app/(app)/tasks/types/task-board.ts` for `TaskWithCoworker`). Document the type as a view model in a short comment.
- **Mappers live next to the consuming UI** (e.g. `mapTaskToTaskWithCoworker` in `tasks/utils/task-view-model.ts`). Do not put feature view-model mappers under `src/lib/types/` or generic `src/lib/utils/`.
- **Prefer pushing shared computed fields to Core** when more than one surface needs them. Example: `jobStatusSettled` is on Core `JobSummary` / `Job` — web must not recompute settlement from timestamps.
- **`src/lib/types/core-dto.ts`** stays for cross-cutting Core helpers and field-derived type aliases — not for feature view models.

### Core API reads & caching (performance)

Web data access for domain entities goes through the Core API
(`coreClient` in `src/lib/clients/core.client.ts`). Two performance rules:

- **Never blindly cache Core responses across requests.** Every `coreClient`
  call attaches the caller's cookies (`buildAuthHeaders`) and defaults to
  `cache: "no-store"`, because most responses are **user/workspace-scoped** —
  caching them in Next's shared fetch cache would leak one user's data to
  another. Keep `no-store` for anything user-specific.
- **Do cross-request cache _global_ catalog reads.** The agent catalog
  (`GET /v1/agents`) is global — it carries no per-user fields and is not
  user-scoped — so it is safe to share. `getAllCoreAgents`
  (`src/lib/agents/core-loaders.ts`) loads every page of the catalog; without
  caching, **every page that needs agents re-paginates the whole catalog over
  HTTP on every request** (React `cache()` only dedupes within one request).
  It opts into fetch-level revalidation via `coreClient.getAgents(query,
  { revalidate, tags: [AGENTS_CACHE_TAG] })`, so the catalog is fetched at most
  once per TTL across all users. Invalidate on demand from a Server Action
  with `updateTag(AGENTS_CACHE_TAG)` (Next.js Cache Components; prefer
  `updateTag` over the two-arg `revalidateTag` profile API). The proper
  long-term fix is a Core endpoint that returns the filtered catalog in one
  call (see the `TODO(core-api)` in `core-loaders.ts`); until then, do not
  add new per-request all-pages loops.

**A catch-all fallback swallows the sign-in redirect.** `coreClient` turns a
Core 401 into a thrown `redirect` to `/signin`, and a `.catch(() => fallback)`
catches it too, so a dead session renders the degraded page instead. Call
`unstable_rethrow(error)` from `next/navigation` first (as `tasks-page-data.ts`
does), or read through `coreClientNoRedirect` and handle the 401 yourself.

### Navigation opens a loaded page, not its skeleton

A click, a predicted approach, or a back press must open a page whose content
is already loaded. Next's default `<Link>` prefetch loads only the App Shell,
so the click still shows `loading.tsx`. Sokosumi loads the page's content
ahead of the click: a **content prefetch**. Apply this when you add or change
a list page, a detail page, a Core read that such a page uses, or any link to
one of them (nav row, list row, back link).

1. **Make the page content-prefetchable.**
   - Read the page's data through `"use cache: private"` loaders. The pattern
     is `loadTasksPageData` in `src/app/(app)/tasks/utils/tasks-page-data.ts`:
     one private-cached loader, and an outage falls back to `connection()` and
     a fresh read.
   - On the content's path, the page and its layouts call no `connection()`
     and make no uncached Core read. A read that must stay fresh (a banner)
     goes in its own `<Suspense>` and streams in after the click.
   - Render `<RefreshPrefetchedPage />` in the page. It refreshes only when
     the page may show an old copy: after back or forward, on a return to a
     page first visited, since its last refresh, more than 30 s ago (Next
     reuses that visit's copy), and when the shared layouts are older than
     `LAYOUT_REFRESH_MS` (2 min). Otherwise
     a click opens page data at most about a minute old and does not refresh.
     It refreshes through a Server Action that calls `refresh()`
     (`refreshPage`), which keeps every page prefetched for the next click;
     `router.refresh()` drops them all. It waits while a link to another page
     or a button has the pointer or keyboard focus (up to 3 s): a navigation
     during the refresh makes Next run a `router.refresh()` after it, and a
     button's Server Action would queue behind it. This one-render action is
     the exception to the background-action rule in "Server actions vs Route
     Handlers": only an action can refresh the page and keep the loaded ones.
     Pass `everyVisit` only for a page whose cached copy must not linger (the
     Ads lost-project state).
   - Add the path to `CONTENT_PREFETCH_PATHS`
     (`src/lib/navigation/content-prefetch-routes.ts`) and set
     `prefetchContent` on its sidebar row in
     `src/app/(app)/components/sidebar/components/menu-items.tsx`.
2. **Link to it with an intent link.**
   - Nav and list rows: `RestingIntentLink` with `prefetchContent`
     (`src/components/resting-intent-link.tsx`). It loads the content on a
     predicted pointer approach (ForesightJS), a resting hover, or resting
     keyboard focus.
   - Back links to a parent page: `BackLink` (`src/components/back-link.tsx`).
     It loads the parent as soon as it shows, which also covers a phone tap,
     and decides from `canPrefetchRouteContent(href)` whether the parent
     supports it.
   - A page that is not content-prefetchable keeps a plain `<Link>`.
   - With no intent at all, `WarmLikelyPages`
     (`src/components/warm-likely-pages.client.tsx`, in the app frame) keeps
     the reader's 3 most visited content pages loaded while the tab is
     visible and in use. A new content page joins it once it is in
     `CONTENT_PREFETCH_PATHS`.
3. **Start content loads only through `prefetchRouteContent(router, href,
   { keepLoaded })`** (`src/lib/navigation/prefetch-route-content.ts`).
   - Each call is one server render of the page. Trigger it on reading
     intent, never for every link in view.
   - Pass `keepLoaded`. Each `router.refresh()` (a polling page, a live
     update, the `RefreshPrefetchedPage` fallback) and each Server Action
     that calls `revalidatePath` or `updateTag` or writes a cookie drops
     every prefetched page, and Next loads only the shell again.
     `keepLoaded` returns true while the reader still wants that page (the
     pointer still rests, the back link still shows), and the page then
     loads again, up to `MAX_CONTENT_RELOADS` times.

**Done when** a production build opens the page with its content, not its
skeleton, after a hover, after a predicted approach, and on back. `next dev`
does not prefetch, so check this on the preview (`/deploy all`), not locally.

### After a mutation: refresh only what changed

`router.refresh()` makes a new server request and re-renders every Server
Component of the current route. Most mutations change one path, tag or query.
Refresh only that.

- A Server Action that calls `revalidatePath`, `updateTag` or `refresh()`
  (from `next/cache`) already sends the re-rendered route in its own response
  (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`). Do **not**
  also call `router.refresh()` on the client after that action. It is a second
  roundtrip for the same data.
- Pick the first option that works:
  1. Update client state from the action result (local state, or React Query
     `setQueryData`).
  2. Invalidate the exact scope: `revalidatePath(path)` or `updateTag(tag)` in
     the Server Action, or `queryClient.invalidateQueries({ queryKey })` for
     React Query data.
  3. `refresh()` in the Server Action, when the view reads state outside the
     cache that the action changed.
  4. `router.refresh()` on the client, only when no Server Action ran (for
     example after a `fetch` to a Route Handler) and no narrower option covers
     the change. Write the reason in a code comment.
- Do not call `revalidatePath("/", "layout")` to be safe. It invalidates all
  cached data of every route.

### Optimistic UI

Think about optimistic UI for each user-triggered mutation.

- Use it when the action is fast, usually succeeds and is easy to undo:
  toggles, pins, renames, reorders, read markers, adding or removing a list
  item. Use `useOptimistic` with `useTransition`
  (`node_modules/next/dist/docs/01-app/02-guides/interactive-apps.md`), or
  React Query `onMutate` with a rollback in `onError`.
- Do not use it when the action charges money (Stripe checkout, billing),
  deletes data that cannot be restored, or returns a value the server decides
  (IDs, prices, validation errors). Show a pending state and wait for the
  result.
- On failure, show the error and go back to the server value. A Server Action
  that returns `{ ok: false }` (see
  [Server action Results](#server-action-results-neverthrow--wire-dto)) does
  not throw, so no error boundary catches it. Handle that result yourself.

### Better Auth ID generation

- Better Auth runs on **Core**, not web. `apps/core/src/lib/auth.ts` sets `advanced.database.generateId: "uuid"` so Better Auth–managed rows get UUID-shaped primary keys, consistent with `@sokosumi/database` Prisma models. Web reaches auth via `auth.client.ts` / `auth.server.ts` → Core `/auth` only. Do not remove or change UUID generation without aligning the shared schema and any database migrations.

### Stripe: Sandbox (test) vs production

Stripe **test mode** and **live mode** are separate environments. The app does not switch modes in code; it uses whatever `STRIPE_*` env vars are set.

| Aspect             | Sandbox (test)                                                  | Production (live)                                                              |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **API keys**       | `sk_test_...`, `pk_test_...`                                    | `sk_live_...`, `pk_live_...`                                                   |
| **Data**           | Coupons, products, prices, customers in **test** dashboard only | Same resources must exist in **live** dashboard; they are not copied from test |
| **Webhook secret** | From Stripe test webhook endpoint                               | From Stripe live webhook endpoint                                              |

**If coupons work in sandbox but not in production:**

1. **Coupon/product IDs** – Create the same coupons (and credit product/prices) in the **live** Stripe Dashboard, or set production env vars to the live coupon/product IDs. Test data does not exist in live.
2. **Stripe customer** – Users have a `stripeCustomerId` in your DB; in production that ID must refer to a customer in the **live** Stripe account. New production users get a customer created in live when they first use Stripe.
3. **Auth in server actions** – When claiming a coupon from a server action, the credits flow passes the request auth into `stripeService.claimCoupon` so it does not rely on `getAuthContext()` again (which can be null in production if cookies/headers differ).

Env vars that must be set per environment (web): `STRIPE_SECRET_KEY`, `STRIPE_CREDIT_PRODUCT_ID`. The webhook secret (`STRIPE_WEBHOOK_SECRET`) is configured on the core app, which owns the `customer.created` webhook. Signup bonus credits (`SIGNUP_BONUS_CREDITS`, `SIGNUP_BONUS_TTL_DAYS`) are also configured on core and granted directly on user creation.

**Enterprise subscription products:** Enterprise products are discovered from Stripe product metadata, not env vars. Configure each active enterprise product with `metadata.slug=enterprise`, `metadata.credits=<positive integer>`, and a monthly recurring `default_price`.

**Coupon semantics for credits:** Credits come from the coupon metadata key `credits` (positive integer). The discount at checkout is applied via the coupon’s `percent_off`. Only coupons with both `metadata.credits` and `percent_off` are supported; `amount_off`-only coupons are not supported.

### Styling

- **Brand direction**: The [Masumi Family brand guide](https://github.com/masumi-network/Masumi-Family-Brand-Guide) is the design system (Iris Flower primary with Neutral 950 text, shared neutrals, no glow or blur), and `globals.css` carries its values. Iris is a fill, never text or a thin mark on the page. The one exception is the navigation progress bar (`DESIGN.md`, **Motion**). Preview it at `/admin/design-system`. See [Web UI conventions](../../docs/agents/web-ui.md).
- Use semantic tokens from `globals.css`. No raw Tailwind palette colors, no hex/rgb/hsl
  literals, no opacity modifiers on color utilities. Use the neutral steps
  (`border-border` / `bg-quinary` / `bg-muted`) and add a token when none fits, in both theme
  blocks and in the `@theme inline` bridge. Guard:
  `src/lib/utils/__tests__/src-walk-guards.test.ts`. See [Color tokens](../../.cursor/rules/color-tokens.mdc).
- Ensure dark/light mode compatibility
- Use `size-*` utilities instead of `h-* w-*`
- **Dynamic Type (iOS/macOS)**: Root rem may track Apple Dynamic Type (`-apple-system-body`); Inter stays the face; scale capped at **1.25×** (max 20px root). See [Dynamic Type](../../.cursor/rules/dynamic-type.mdc) and `apps/web/src/lib/utils/dynamic-type.ts`.
- **Font sizes**: Never set a literal font size in product UI: no arbitrary `text-[…]` in any unit (`text-[10px]`; `text-[0.8125rem]` is the same off-scale 13px), no `text-[length:…]` or `text-(length:…)`, and no literal `font-size`/`fontSize` in px, rem or em (`font-size: 12px`, `fontSize: "0.875rem"`, `fontSize: 14`). Use a scale step: `text-2xs` (11px, dense meta and badges only) through `text-4xl`. They are rem, so type scales with root. `apps/web/src/lib/utils/__tests__/src-walk-guards.test.ts` fails each spelling and lists the few exceptions with their reason.
- **Whole pixels**: Never a fractional `px` on a layout or border length (`p-[1.5px]`, `padding: 1.5px`, `border: "0.2px solid …"`). A 1x display has no half pixel, so the browser rounds a `1.5px` border to 1px on one edge and 2px on the other. Shadow radii, keyframe translations and unitless scale factors stay continuous. See [Whole pixels](../../.cursor/rules/whole-pixels.mdc).

## Development Workflow

1. **Start Development**: `pnpm portless:dev` from repo root (`pnpm portless:web` for web only; `pnpm web:dev` for classic `:3000`)
2. **Testing**: Run `pnpm web:test` before committing
3. **Formatting**: Run `pnpm format` after changes

## Common Patterns

### Creating a New Page

```typescript
// src/app/(app)/new-page/page.tsx
import type { Metadata } from "next";

import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "New Page",
};

export default function NewPage() {
  return (
    <div className={cn(HOLDER_CLASS, "flex w-full flex-col gap-2")}>
      <div className={cn(HOLDER_ITEM_CLASS, "px-4 py-3")}>
        {/* Server Component content */}
      </div>
    </div>
  );
}
```

### Creating a Server Action

```typescript
// src/lib/actions/new-action.ts
"use server";

import { ok, type Result } from "neverthrow";
import {
  toActionResult,
  type ActionResultDto,
} from "@/lib/actions/action-result";

// wire: { ok: true; value: T } | { ok: false; error: E }
export async function createNewItem(): Promise<
  ActionResultDto<{ id: string }, ActionError>
> {
  const result: Result<{ id: string }, ActionError> = ok({ id: "…" });
  return toActionResult(result);
}
```

### Using Translations

```typescript
// In a component
import { useTranslations } from 'next-intl';

export function MyComponent() {
  const t = useTranslations('CookieConsent');
  return <h1>{t('title')}</h1>;
}
```

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands. With `"engine": "lightpanda"` in `~/.agent-browser/config.json` (`navigator.userAgent` reports `Lightpanda`) it has no layout or CSS: for screenshots, measurements and phone layout, follow [Verifying Web UI](docs/verification.md).

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

### Logging in (auth-gated pages)

The sign-in form is a controlled `react-hook-form`. Programmatic value-setting
(the auth-vault `fill`→`click` path) can race React's state flush, so the
vault's submit **click** often no-ops while the field values look correct. The
form itself is fine — submitting via **Enter** works because state has flushed
by then.

`$WEB_URL` is `pnpm portless:url web` (or `web_url=` from `verify-sokosumi doctor`). Do not hardcode `:3000`.

Each coworker stores their **own** credentials (nothing shared/committed).
Prefer `verify-sokosumi sign-in` (fixtures, then the vault). The sign-in steps
live in [verify-sokosumi](../../.cursor/skills/verify-sokosumi/SKILL.md) and
[sign-in](../../.cursor/skills/verify-sokosumi/features/sign-in.md).

Do not `wait --load networkidle` on `/chat` after login — Ably hangs that wait. Prove the session on `/agents`.

Prefer session reuse so you only log in once per machine:

```bash
export AGENT_BROWSER_SESSION_NAME=sokosumi   # auto-saves/restores cookies
```

## Agent skills

When implementing or reviewing UI in this app, load and follow these app-scoped skills. Read them by path even when a root-started session does not list them. Do not invent parallel UI rules.

- [`.agents/skills/better-ui/`](.agents/skills/better-ui/)
- [`.agents/skills/better-typography/`](.agents/skills/better-typography/)
- [`.agents/skills/better-colors/`](.agents/skills/better-colors/)
- [`.agents/skills/better-accessibility/`](.agents/skills/better-accessibility/)
- [`.agents/skills/better-layout/`](.agents/skills/better-layout/)
- [`.agents/skills/better-writing/`](.agents/skills/better-writing/)
- [`.agents/skills/better-interface/`](.agents/skills/better-interface/)
- [`.agents/skills/interface-review/`](.agents/skills/interface-review/)
- [`.agents/skills/explain-interface/`](.agents/skills/explain-interface/)
- [`.agents/skills/variant/`](.agents/skills/variant/)
- [`.agents/skills/break/`](.agents/skills/break/)

## Additional Rules

- [Avoid re-exports](../../.cursor/rules/avoid-re-exports.mdc) – import entity types from `@sokosumi/core-client` or `@/lib/types/core-dto`; import Better Auth session types (`Session`, `SessionUser`, `SessionRecord`, `Account`) and other approved pure helpers from `@sokosumi/utils` directly; no passthrough files. See [Core DTO boundary](#core-dto-boundary).
- [Utils vs database helpers](../../.cursor/rules/utils-vs-database.mdc) – import `@sokosumi/utils` from client components; web never imports `@sokosumi/database`
- [Whole pixels](../../.cursor/rules/whole-pixels.mdc) – no fractional `px` on a layout or border length; guard `src/lib/utils/__tests__/src-walk-guards.test.ts`
- [Effects](.cursor/rules/effects.mdc)
- [Translations](../../.agents/skills/translations/) – next-intl cleanup and locale parity
- [Locale-safe formatting](.cursor/rules/i18n-formatting.mdc) – `useFormatter` / `getFormatter`; avoid bare `toLocaleString()` in client components

## References

- [Root AGENTS.md](../../AGENTS.md) - Comprehensive monorepo guidelines
- [Next.js App Router](https://nextjs.org/docs/app)
- [Next-intl Documentation](https://next-intl.dev/)
- [Shadcn UI Components](https://ui.shadcn.com/)

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
