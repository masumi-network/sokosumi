# Hermes (Beta)

Hermes is a per-user, microVM-isolated AI agent that lives at `/personal-assistant`. It's
the user's personal interface into Sokosumi: it reads their inbox + calendar,
hires Sokosumi agents on their behalf, remembers context across sessions,
and runs scheduled tasks while they sleep.

This README is the engineering map for the Hermes feature surface. For
end-user copy and screenshots, see the in-app empty state.

---

## System overview

```
                     ┌──────────────────────┐
   browser  ──────►  │  apps/web (Next.js)  │
                     │ /personal-assistant  │
                     └──────────┬───────────┘
                                │ server actions / SDK calls
                                ▼
                     ┌──────────────────────┐
                     │  apps/core (Hono)    │
                     │  /v1/hermes/*        │
                     └──────────┬───────────┘
                                │ Bearer-auth
                  ┌─────────────┼─────────────┐
                  ▼                           ▼
       ┌────────────────────┐      ┌────────────────────┐
       │ Hermes Orchestrator│      │  Composio          │
       │ (Railway)          │      │  (managed OAuth +  │
       │  - microVM per     │      │   MCP broker)      │
       │    user            │      │  - Gmail / Outlook │
       │  - integrations    │      │  - Slack / Linear  │
       │  - inbox / cron    │      │  - 14 toolkits     │
       └────────────────────┘      └────────────────────┘
```

- **apps/web** owns the UI flow, server actions, and the Composio callback page.
- **apps/core** owns the orchestrator client, Composio client, server routes
  for `/me/instance`, integrations init/finalize, inbox polling, and the
  schemas that drive both.
- The **orchestrator** is a separate service we don't run in this repo. It
  hosts the Fly.io microVM lifecycle and persists per-user Hermes state.
- **Composio** is the managed-OAuth + MCP broker. We rely on its verified
  Google/Microsoft/etc. OAuth apps so we never store the user's third-party
  tokens; the orchestrator only ever sees a scoped MCP URL.

---

## UI flow (machine states)

The page is a state machine driven off `getHermesInstanceAction`:

| State                   | Component             | What's happening                                                                                                                       |
| ----------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `idle`                  | `EmptyState`          | No instance. Activation-first hero, capability summary, shortened journey, features, things-to-try carousel, disclaimer.               |
| `provisioning`          | `ProvisioningState`   | `POST /me/instance` fired. Fly machine is booting; UI shows elapsed time, honest milestones, and rotating Hermes facts.                |
| `infrastructure_ready`  | `OnboardingScreen`    | Machine up, awaiting user. Six-step wizard: **Name → Look + personality → Autonomy → Integrations → Skills → Review**. The skills marketplace mounts hidden from wizard load so its (slow) catalog fetch warms during the earlier steps; installs fire immediately and are on the machine when setup finishes. Personality is chosen here only (not editable later in Settings). |
| `onboarding`            | `OnboardingProgress`  | `POST /me/instance/onboard` fired. Polls `/onboarding-progress` every second; renders the orchestrator's step list with status icons.  |
| `ready` / `running`     | `RunningState`        | Chat is open. Header chips: Autonomy → Autonomy panel (level + scheduled tasks); Skills → Skills marketplace popup (`skills-dialog.tsx`); Integrations → Settings.   |
| `error`                 | `ErrorState`          | Orchestrator error, fetch failure, or client provision timeout. Retry refetches instance status (does not re-fire provision). Start over destroys when status is `error`/`provisioning` or after a provision timeout. |

All states share a `FlowBackground` (animated violet/cyan/amber blobs) and
the `ProgressPips` macro indicator (`Setup → Personalize → Ready`).

The wrapper `HermesExperience` polls the instance, normalizes states, and
unmounts the polling effect when the route leaves the foreground.

### Full-bleed chat under the shared header

The shared `AppLayout` renders a breadcrumb `Header` (reserving 64px) on every
route, and the Personal Assistant surface keeps it like everywhere else. It
only opts into a full-bleed content area below the header via:

- `FullscreenEffect` (`components/fullscreen-effect.tsx`) — client component
  mounted from the layout that toggles `data-hermes-fullscreen="true"` on
  `<body>`. A rule in `globals.css` keyed off that attribute drops
  `[data-app-main]`'s `p-4` gutter (keeping the mobile fixed-header top
  clearance) so the chat/empty-state fills the area while main keeps its
  normal `calc(100svh-64px)` height and `overflow-y-auto`.

---

## Autonomy levels

The orchestrator exposes three operational tiers on every instance:

| Level    | Behavior                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `low`    | Read-only. Write tools stripped from the catalog. Hermes can list / search / fetch but cannot send mail, open tickets, or run jobs.     |
| `medium` | Default. Write tools available, but Hermes is system-prompted to confirm in chat before any spend or non-trivial write.                 |
| `high`   | Fully autonomous within cost rules — refuses if balance would drop below 10 credits; asks if a single job exceeds 25% of balance.       |

Surfaces:

- **Onboarding step 3** — `AutonomySelector` (radio cards with accent-tinted icon tiles).
- **Autonomy panel** (header chip) — same selector plus the scheduled-tasks list. Edits fire `PATCH /me/instance` (`updateHermesInstanceAction`); optimistic local state reverts on error.
- **Type** — `HermesAutonomyLevel = "low" | "medium" | "high"`; default `"medium"` everywhere.

### Personality (setup-only)

Tone / detail / style (0–100) are chosen on onboarding step 2 (Look + personality), forwarded to the orchestrator, and mirrored on `hermesInstance`. Settings can rename the assistant and re-pick the orb colour after setup; **personality is not editable post-onboard** (no PATCH field today). Re-provision / destroy + activate again is the only way to change it.

---

## Integrations

Hermes connects to third-party services through **Composio** (managed OAuth
+ MCP broker). We don't ship our own Google/Microsoft OAuth client — we use
Composio's verified ones.

### Supported providers

Gmail, Google Calendar, Google Sheets, Google Docs, Outlook (mail + calendar),
Slack, Microsoft Teams, Linear, Jira, GitHub, Notion, HubSpot, X (Twitter),
LinkedIn, Instagram, YouTube. See `apps/core/src/clients/composio.client.ts`
for the `TOOLKIT_BY_PROVIDER` map and per-(toolkit, mode) `ALLOWED_TOOLS`.

### Modes

Each connection has a `mode`: `"read"` or `"write"`. Mode is enforced at three
layers:

1. **Composio MCP `allowed_tools` whitelist** — the read-mode MCP literally
   doesn't surface `*_SEND_*` to Hermes.
2. **Orchestrator MCP proxy** — strips write-pattern tool names again on its
   side based on the `mode` we POST.
3. **System prompt** — for `low`/`medium` autonomy, Hermes is instructed not
   to use write tools without confirmation.

> OAuth scope narrowing per (toolkit, mode) does **not** work. Google blocks
> Composio's managed client with "This app is blocked" when scopes are
> narrowed. The two enforcement layers above cover us instead.

### The OAuth flow

1. User clicks a provider's **Connect** button in onboarding or settings.
2. `ConnectInterstitial` opens — sets expectations about the broad consent
   screen and shows `Continue to {Microsoft|Google|Slack|…}` (mapped from
   the toolkit slug via `AUTH_PROVIDER_BY_SLUG`).
3. `useComposioOAuth` opens a popup to Composio's `connect.composio.dev` link
   page; the orchestrator's `initiate` route returned `{ redirectUrl, connectionId }`.
4. User completes consent on the third-party site; the popup redirects to
   `/composio/callback` which `postMessage`s the result back to the parent.
5. Parent calls `finalizeHermesIntegrationAction` → `POST /me/instance/integrations/finalize`
   → server polls Composio until `ACTIVE` → registers the MCP URL on the
   orchestrator under every provider slug this connection covers (Outlook's
   single toolkit covers both `outlook` mail AND `outlook_calendar`).

### Composio gotchas worth knowing

- **Outlook tools-listing endpoint is incomplete.** `?toolkit_slug=outlook`
  returns a 43-item subset of the ~200-tool catalog. Don't rely on that
  listing to decide what's valid for MCP. Verify by attempting MCP server
  creation with the slug.
- **30-char MCP server name cap.** `${toolkit}-${mode}-v5` must fit. We use
  compact aliases (`gcal`, `gsheets`, `gdocs`, `teams`) in `mcpServerName`.
- **Auth-config singleton per toolkit.** Composio's managed OAuth client is
  one per toolkit — narrowing scope at the auth_config level isn't supported
  by Google.

---

## Server-side surface (apps/core)

Hermes routes under `/v1/hermes/*`:

| Method | Path                                       | Purpose                                                                          |
| ------ | ------------------------------------------ | -------------------------------------------------------------------------------- |
| GET    | `/me/instance`                             | Returns `{ hasInstance, instance? }`. Polled by the UI.                          |
| POST   | `/me/instance`                             | Provision. Idempotent.                                                           |
| PATCH  | `/me/instance`                             | Update autonomy / name / email. Returns the refreshed instance.                  |
| DELETE | `/me/instance`                             | Destroy + clear local mirror.                                                    |
| POST   | `/me/instance/onboard`                     | Start the orchestrator's research-intro flow. PATCHes autonomy first if given.   |
| GET    | `/me/instance/onboarding-progress`         | Step-by-step progress for the loader UI.                                         |
| GET    | `/me/instance/integrations`                | List integrations.                                                               |
| POST   | `/me/instance/integrations/initiate`       | Kick off Composio OAuth; returns popup URL + connectionId.                       |
| POST   | `/me/instance/integrations/finalize`       | Poll Composio until ACTIVE; register MCP on orchestrator.                        |
| DELETE | `/me/instance/integrations/:provider`      | Disconnect.                                                                      |
| GET    | `/me/instance/schedules`                   | Cron rows (orchestrator-managed + Hermes-managed).                               |
| GET    | `/me/messages`                             | Persisted message history.                                                       |
| POST   | `/me/secrets`                              | Set a secret on the user's microVM (validated key pattern).                      |
| POST   | `/me/inbox/seen`                           | Mark messages as seen.                                                           |

Source files of note:

- `apps/core/src/clients/hermes-orchestrator.client.ts` — typed wrapper around
  the Railway orchestrator. Exposes `provisionInstance`, `patchInstance`,
  `connectInstanceIntegration`, etc.
- `apps/core/src/clients/composio.client.ts` — Composio v3 API client.
  Lazily ensures one auth_config per toolkit and one MCP server per
  `(toolkit, mode)` pair, caches IDs per process.
- `apps/core/src/schemas/hermes.schema.ts` — Zod-OpenAPI schemas for every
  request/response shape. Drives the generated SDK in `apps/web`.
- `apps/core/src/services/hermes-inbox-sync.service.ts` — pulls
  agent-initiated messages out of the orchestrator inbox into our DB.

### Sokosumi env routing

`provisionInstance` accepts a `sokosumiEnv: "development" | "preprod" | "mainnet"`
field; the orchestrator uses it to pick the right Sokosumi API base + coworker
key. Core's `resolveSokosumiEnvForOrchestrator()` passes `"preprod"` or
`"mainnet"` from `NETWORK` (`"Mainnet"` → `"mainnet"`, else `"preprod"`,
including local dev defaults).

### Dev-only inbox poller

In production, Vercel cron pings `/sync/hermes/poll-inboxes`. Locally there's
no cron, so the orchestrator's welcome messages and any agent-pushed inbox
traffic never land in our DB. `apps/core/src/index.ts` includes a
development-only `setInterval` that calls the inbox-sync service every 30s
when `NODE_ENV === "development" && HERMES_INBOX_POLLING_ENABLED === "true"`.

---

## Local development

### Required env

Add to `apps/core/.env` (template in `.env.example`):

```
HERMES_ORCH_BASE_URL="https://orchestrator-production-35d4.up.railway.app"
HERMES_ORCH_TOKEN="<bearer-token>"
HERMES_INBOX_POLLING_ENABLED="true"   # opt-in dev inbox poll

COMPOSIO_API_KEY="ak_..."
COMPOSIO_API_BASE_URL="https://backend.composio.dev"
```

The orchestrator + Composio creds are shared with the team — ask in the
project channel if you don't have them yet. Never commit them.

### Enabling the feature

The route is open to all authenticated users; activating **and using**
(chat, onboard, settings mutations, skills, confirmations) are gated by a
paid plan (or admin role) on the Core endpoints. Viewing history and
destroying an instance stay open so cancelled users can tear down.

### Bypassing the subscription gate

`AppLayout` shows a "Start a subscription to continue" gate when
`currentPlan === "free"` AND `credits <= 0`. To silence it locally, give your
user a mock pro subscription + credit bucket. The DDL is in
`buildLocalFreeSubscriptionPeriodReferenceId`-adjacent helpers; the quick
SQL recipe is:

```sql
DO $$
DECLARE _uid text := '<your-user-id>'; _now timestamptz := NOW();
DECLARE _end timestamptz := NOW() + INTERVAL '30 days';
BEGIN
  INSERT INTO subscription
    (id, "createdAt", "updatedAt", plan, "referenceId", status,
     "periodStart", "periodEnd", "cancelAtPeriodEnd", seats, "billingInterval")
  VALUES (gen_random_uuid()::text, _now, _now, 'pro', _uid, 'active',
          _now, _end, false, 1, 'month');

  INSERT INTO "Transaction" (id, "createdAt", "updatedAt", amount, "userId")
  VALUES (gen_random_uuid()::text, _now, _now, 100000000000000, _uid);

  -- Plus a matching credit_bucket; see apps/core/src/helpers/subscription.ts
END $$;
```

### Preview states

Each state component accepts a `previewMode` prop. Append
`?state=<state>` to the URL (`infrastructure_ready`, `onboarding`,
`running`, etc.) to render that view without driving the real orchestrator.
Useful for design iteration.

### Resetting an instance

`DELETE /v1/instances/:userId` on the orchestrator (mirror also clears
`hermesInstance` + `hermesMessage` + `hermesPendingConnection` in our DB via
the destroy route). Orchestrator-side deletes must also
`POST /v1/hermes/instances/{userId}/purge`. For a hard local-only reset, drop
those rows directly.

---

## Web-side files

```
apps/web/src/app/(app)/personal-assistant/
├── README.md                            ← you are here
├── layout.tsx                           ← FullscreenEffect wrapper
├── page.tsx                             ← session pass-through, renders HermesExperience
└── components/
    ├── hermes-experience.tsx            ← state machine + polling
    ├── empty-state.tsx                  ← shell: /personal-assistant when no instance
    ├── empty-state/                     ← hero + journey + features + examples + disclaimer modules
    ├── provisioning-state.tsx           ← honest "Setting up your agent…" view
    ├── onboarding-screen.tsx            ← 6-step wizard: Name → Look/personality → Autonomy → Integrations → Skills → Review
    ├── onboarding-progress.tsx          ← orchestrator step poll UI
    ├── running-state.tsx                ← chat shell (hooks + panels + layout)
    ├── running-state/                   ← timeline, composer, confirmations, scroll/send/inbox hooks, stream
    ├── error-state.tsx                  ← retry / start-over from error
    │
    ├── autonomy-selector.tsx            ← shared low/medium/high radio cards
    ├── autonomy-panel.tsx               ← autonomy level + scheduled tasks sheet
    ├── settings-panel.tsx               ← name / orb / integrations / sync / danger
    ├── skills-marketplace.tsx           ← skills.sh catalog (wizard step + Skills dialog)
    ├── skills-dialog.tsx                ← Skills marketplace popup, opened from the chat-header chip
    ├── connect-interstitial.tsx         ← pre-OAuth modal; maps slug → identity provider
    ├── use-composio-oauth.ts            ← popup orchestration + postMessage handshake
    │
    ├── flow-background.tsx              ← animated gradient blobs
    ├── fullscreen-effect.tsx            ← body data-attr toggle for full-bleed below header
    ├── progress-pips.tsx                ← Setup / Personalize / Ready
    └── rotating-messages.tsx            ← cycling text (provisioning + thinking)
```

Public assets:

- `apps/web/public/icons/*.svg` — 17 brand SVGs for connectors (Gmail,
  Outlook, Slack, …). Fetched via the `better-icons` CLI; some had to be
  swapped from `logos:*` (gradient SVGs that `better-icons --color` corrupts)
  to `simple-icons:*` flat versions (Jira, Teams).

Server actions live in `apps/web/src/lib/actions/hermes/action.ts`; types
are mirrored in `apps/web/src/lib/hermes/types.ts`. The generated SDK
(`apps/web/src/lib/clients/generated/core/*`) is refreshed via `pnpm --filter
web generate:core:snapshot`.

---

## Resilience notes

- **Neon pooled transactions** time out under load. We removed interactive
  `prisma.$transaction` wrappers from read-only paths in
  `agent.service.ts#getAvailableAgents` and
  `getAvailableAgentsWithCreditsPrice`, and added a `.catch()` fallback in
  `BreadcrumbNavigation` so a transaction timeout doesn't 500 the whole app
  shell.
- **Layout-level fetch failures** are swallowed (`.catch(() => null)`) so a
  flaky orchestrator doesn't take down the rest of the app.
- The Hermes orchestrator can take 60–120 seconds to provision. The UI
  surfaces this honestly ("This takes a few minutes. You can close this
  tab.") rather than faking a per-second countdown.

---

## Conventions

- **No em-dashes** in user-visible copy. Use periods, commas, or colons.
- **No ad-hoc text sizes** (no `text-[10px]`, `text-[15px]`). Stick to the
  Tailwind scale.
- **Color is reserved for status** — success (emerald), warning (amber),
  destructive (red). The five accent colors (violet/cyan/amber/emerald/rose)
  are for section eyebrows + per-tier accents only; don't sprinkle them.
- **Borders dominant.** Avoid heavy drop shadows. The empty-state journey
  visualizations are explicit about this — color appears only on active
  dots, success checks, and the spend-credits badge.
