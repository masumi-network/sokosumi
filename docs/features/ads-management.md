# Ads Management

Last updated: 2026-09-30

## Goal

Let a Project manage its Google Ads and Meta Ads campaigns and see trending ads and keywords in its market, all through Composio. New "Ads" entry in the desktop sidebar; on mobile it is a row on the You page. Beta-gated like Social.

## Decisions (Francis, 2026-09-30)

- **Scope: Project.** Ad accounts connect per Project (brand/client), like Project social connections. Web page uses the existing `?projectId=` project picker.
- **Campaigns v1:** list with metrics, pause/resume, change daily budget, create campaign. Campaign level only (Composio `metaads` has no ad set/ad update tools).
- **Market:** Composio out of the box + DataForSEO. Google ads come from DataForSEO's Google Ads Transparency endpoints, which return `preview_image`. Meta Ad Library is a later ticket (not in Composio; EU-only commercial ads; needs Meta ID verification).
- **Rollout:** beta gate = existing social beta (`utxo` Workspace members), reuse `hasCurrentUserSocialBetaAccess` / `requireSocialBetaAccess`.
- **Safety:** new campaigns are always created **PAUSED**. Budget and status changes need a confirm step in Web.

## Integrations (all via Composio)

| Need | Toolkit / call | Auth |
|---|---|---|
| Google Ads accounts | `GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS`, GAQL on `customer` / `customer_client` | Per-user OAuth; Composio auth config holds our Google Ads developer token |
| Google campaigns + metrics | `GOOGLEADS_SEARCH_STREAM_GAQL` | same |
| Google status / budget | `GOOGLEADS_MUTATE_CAMPAIGNS`, `GOOGLEADS_MUTATE_CAMPAIGN_BUDGETS` | same |
| Google create | `GOOGLEADS_MUTATE_CAMPAIGN_BUDGETS` then `GOOGLEADS_MUTATE_CAMPAIGNS` (Search, Maximize clicks, PAUSED, `contains_eu_political_advertising = DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING`) | same |
| Meta ad accounts | `METAADS_GET_AD_ACCOUNTS` | Per-user OAuth; our own Meta app (no Composio-managed OAuth) |
| Meta campaigns + metrics | `METAADS_LIST_CAMPAIGNS`, `METAADS_GET_INSIGHTS` (level=campaign) | same |
| Meta status / budget | `METAADS_UPDATE_CAMPAIGN` (one budget field per call) | same |
| Meta create | `METAADS_CREATE_CAMPAIGN` (objective, `special_ad_categories: []`, `daily_budget`, PAUSED) | same |
| Trending keywords | DataForSEO `POST /v3/keywords_data/google_ads/keywords_for_keywords/live` | One platform DataForSEO connection (basic auth) |
| Market advertisers | DataForSEO `POST /v3/serp/google/ads_advertisers/live/advanced` (`keyword`, `location_code`) | same |
| Market ads (with `preview_image`) | DataForSEO `POST /v3/serp/google/ads_search/live/advanced` (`advertiser_ids` ≤25, `location_code`, `date_from`) | same |

- Execution of per-user toolkits: reuse the restricted `tool_router` session pattern in `apps/core/src/clients/composio.client.ts` (`getConnectedSocialIdentity`, `publishXPost`): pin toolkit, connected account and an allow-list of tools.
- DataForSEO: one clear path — Composio **proxy execute** on the platform connected account (`COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID`) for all three endpoints. Parse DataForSEO's documented response with zod.
- Google Ads v1 supports directly accessible customer accounts only. Composio's `googleads` tools have no `login-customer-id` parameter, so manager accounts and their client accounts are not offered; `loginCustomerId` stays null (column kept for later).
- Money in API responses: decimal number in account currency + `currency` (ISO code). Google micros ÷ 1e6, Meta minor units ÷ 100.

## Data model (Prisma, `packages/database`)

- `ProjectAdConnection`: `id`, `projectId`, `provider` (`google_ads` | `meta_ads`), `composioConnectedAccountId`, `connectorUserId`, `status`, timestamps. One Composio OAuth grant.
- `ProjectAdAccount`: `id`, `projectId`, `connectionId`, `provider`, `externalAccountId` (Google customer id / Meta `act_…`), `loginCustomerId?`, `name`, `currency`, `timeZone?`, timestamps. `@@unique([projectId, provider, externalAccountId])`.
- `ProjectAdMarketProfile`: `projectId` (unique), `keywords String[]` (1–10), `locationCode Int`, `languageCode String`, `updatedAt`.
- `ProjectAdMarketSnapshot`: `id`, `projectId`, `kind` (`keywords` | `ads`), `requestKey` (hash of profile), `payload Json`, `fetchedAt`. Cache DataForSEO for 24h (it costs per call). `@@unique([projectId, kind, requestKey])`.
- OAuth intents reuse `ProjectSocialConnectionIntent` (`provider` = `google_ads` / `meta_ads`, `socialConnectionId` null) and the existing `/composio/callback` popup flow. No new callback route.

## Core API (`/v1/projects/{id}/ads/...`, beta + Project access like social connections)

| Method | Path | Purpose |
|---|---|---|
| GET | `/ads/accounts` | Connected ad accounts |
| POST | `/ads/connections/initiate` `{provider}` | Composio link → `{redirectUrl, connectionId}` |
| POST | `/ads/connections/finalize` `{connectionId}` | Store connection, return `availableAccounts[]`; a grant with no ad accounts is revoked and returns `connection: null` |
| POST | `/ads/accounts` `{adConnectionId, externalAccountIds[]}` | Attach chosen accounts; already attached accounts are returned unchanged |
| DELETE | `/ads/accounts/{accountId}` | Detach; revoke the Composio account when its last ad account goes |
| GET | `/ads/accounts/{accountId}/campaigns?range=LAST_7_DAYS\|LAST_30_DAYS` | Campaigns + spend, impressions, clicks, CTR, CPC, conversions |
| PATCH | `/ads/accounts/{accountId}/campaigns/{campaignId}` `{status?: ACTIVE\|PAUSED, dailyBudget?}` | Pause/resume, budget |
| POST | `/ads/accounts/{accountId}/campaigns` `{name, dailyBudget, startDate?, objective? (Meta, required)}` | Create, always PAUSED |
| GET / PUT | `/ads/market` | Market profile |
| GET | `/ads/market/keywords` | Trending keywords (volume, 12-month trend, competition, CPC range) |
| GET | `/ads/market/ads` | Advertisers for the profile keywords → their recent ads with `preview_image`, format, first/last shown |

Errors map through the existing Composio error classes (`ComposioConfigError` → 503 "not configured", `ComposioApiError`/`ComposioToolError` → 502 with a safe message).

## Web (`apps/web/src/app/(app)/ads`)

- Sidebar item "Ads" (lucide `Megaphone`) in `menu-items.tsx`, gated like Social, project-scoped via `project-scope-href.ts`.
- You page: "Ads" row in `you-page.client.tsx`, same gate passed from `you-page-content.tsx`.
- `/ads?projectId=…&tab=campaigns|market|accounts`. Template: `(app)/social/`.
- Accounts: connect via `useComposioOAuthPopup`, pick accounts, disconnect.
- Campaigns: table on desktop, stacked rows on mobile; range switch; pause/resume and budget with confirm; "New campaign" sheet.
- Market: profile form (keywords, country, language); trending keywords list; ads gallery of `preview_image` cards.
- Calm UI per DESIGN.md: one accent, typography over boxes, empty/loading/error states, en/de/es messages.

## Out of scope / follow-ups

- Meta Ad Library (direct Graph API `ads_archive`, EU markets).
- Ad set / ad / creative management.
- Apple app.

## Stack

Plain branches, each based on the one below. Draft PRs. Before every PR: `code-review` (Standards + Spec vs this spec and the Sokosumi task).

| # | Branch | Layer | Scope |
|---|---|---|---|
| 01 | `ads/01-core-schema` | Core | Prisma models + migration, env vars, ads provider config, CONTEXT.md glossary, this spec |
| 02 | `ads/02-core-connect` | Core | Initiate / finalize / attach / list / detach ad accounts |
| 03 | `ads/03-core-campaigns-read` | Core | List campaigns + metrics (Google GAQL, Meta insights) |
| 04 | `ads/04-core-campaigns-update` | Core | Pause/resume, daily budget |
| 05 | `ads/05-core-campaigns-create` | Core | Create campaign (PAUSED) |
| 06 | `ads/06-core-market-keywords` | Core | Market profile + trending keywords (DataForSEO, 24h cache) |
| 07 | `ads/07-core-market-ads` | Core | Market ads with preview images (DataForSEO, 24h cache) |
| 08 | `ads/08-web-shell` | Web | Sidebar + You entry, `/ads` page shell, tabs, empty states, core snapshot |
| 09 | `ads/09-web-accounts` | Web | Connect / pick / disconnect ad accounts |
| 10 | `ads/10-web-campaigns` | Web | Campaign list, pause/resume, budget |
| 11 | `ads/11-web-campaign-create` | Web | New campaign sheet |
| 12 | `ads/12-web-market` | Web | Market profile, trending keywords, ads gallery |

Ops (no PR): Google Ads developer token + Composio `googleads` auth config; Meta app (ads_read, ads_management, App Review, Business Verification) + Composio `metaads` auth config; DataForSEO account + Composio platform connection.
