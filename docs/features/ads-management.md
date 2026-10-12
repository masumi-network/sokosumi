# Ads Management

Last updated: 2026-10-12

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
| Google create | `GOOGLEADS_BATCH_MUTATE` (`partial_failure: false`): budget, PAUSED campaign, criteria, ad group, keywords and ad in one atomic call. See [Google campaign builder](#google-campaign-builder) | same |
| Meta ad accounts | `METAADS_GET_AD_ACCOUNTS` | Per-user OAuth; our own Meta app (no Composio-managed OAuth) |
| Meta campaigns + metrics | `METAADS_LIST_CAMPAIGNS`, `METAADS_GET_INSIGHTS` (level=campaign) | same |
| Meta status / budget | `METAADS_UPDATE_CAMPAIGN` (one budget field per call) | same |
| Meta create | `METAADS_CREATE_CAMPAIGN` (objective, `special_ad_categories: []`, `daily_budget`, PAUSED) | same |
| Trending keywords | DataForSEO `POST /v3/keywords_data/google_ads/keywords_for_keywords/live` | One platform DataForSEO connection (basic auth) |
| Search competitors | DataForSEO queued `POST /v3/serp/google/organic/task_post` (`keyword`, `location_code`, `language_code`, `depth` 10), one task per keyword, all in one request; read with `GET …/organic/task_get/advanced/{id}` | same |
| Competitors' ads (with `preview_image`) | DataForSEO queued `POST /v3/serp/google/ads_search/task_post` (`target` domain, `location_code`, `date_from`/`date_to`, `depth` 40), one task per competitor (≤10), all in one request; read with `GET …/ads_search/task_get/advanced/{id}` | same |

- Execution of per-user toolkits: reuse the restricted `tool_router` session pattern in `apps/core/src/clients/composio.client.ts` (`getConnectedSocialIdentity`, `publishXPost`): pin toolkit, connected account and an allow-list of tools.
- DataForSEO: one clear path — Composio **proxy execute** on the platform connected account (`COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID`) for all three endpoints (`POST /api/v3/tools/execute/proxy`, no tool session). Parse DataForSEO's documented response with zod. Keywords stay live (one task per request). SERPs and ads are queued tasks: live ones hit 60s timeouts half the time when run in parallel, queued ones are ready in about 2.5 min and cost $0.0006 instead of $0.002. See [Market ads job](#market-ads-job).
- Market ads are the **search competitors'** ads: the 10 domains ranking organically for the keywords (most keywords, then best position), each one's 4 newest Transparency Center ads. Not the paid results: DataForSEO SERPs contain no `paid` items (checked 2026-10-07, incl. "car insurance" desktop + mobile), and the `ads_advertisers` endpoint matches advertiser *names*, not keywords.
- Google Ads v1 supports directly accessible customer accounts only. Composio's `googleads` tools have no `login-customer-id` parameter, so manager accounts and their client accounts are not offered; `loginCustomerId` stays null (column kept for later), and `login-customer-id` is deliberately not sent.
- Money in API responses: decimal number in account currency + `currency` (ISO code). Google micros ÷ 1e6, Meta minor units ÷ the currency's minor-unit exponent (`fromMinorUnits`: USD 100, JPY 1). The campaigns response carries one `currency` for the whole account, not one per campaign. Writes differ: `METAADS_UPDATE_CAMPAIGN` takes `daily_budget` as a decimal in account currency, Google budgets are sent as `amount_micros`.
- Tool versions: tool-router sessions always use the latest published toolkit version (Composio supports no version pin on `/api/v3.1/tool_router/session`; only direct tool execution takes one). Tool contracts were checked against `metaads` `20260915_00` and `googleads` `20260922_00`.

## Data model (Prisma, `packages/database`)

- `ProjectAdConnection`: `id`, `projectId`, `provider` (`google_ads` | `meta_ads`), `composioConnectedAccountId`, `connectorUserId`, `status`, timestamps. One Composio OAuth grant.
- `ProjectAdAccount`: `id`, `projectId`, `connectionId`, `provider`, `externalAccountId` (Google customer id / Meta `act_…`), `loginCustomerId?`, `name`, `currency`, `timeZone?`, timestamps. `@@unique([projectId, provider, externalAccountId])`.
- `ProjectAdMarketProfile`: `projectId` (unique), `keywords String[]` (1–10), `locationCode Int`, `languageCode String`, `updatedAt`.
- `ProjectAdMarketSnapshot`: `id`, `projectId`, `kind` (`keywords` | `ads`), `requestKey` (hash of profile), `payload Json`, `fetchedAt`. Cache DataForSEO for 24h (it costs per call). `@@unique([projectId, kind, requestKey])`.
- `ProjectAdMarketAdsJob`: `projectId` (id), `requestKey`, `stage` (`SERP` | `ADS` | `FAILED`), `pendingTaskIds String[]`, `collected Json`, `startedAt`, `nextCheckAt`. One row per Project; deleted when the ads snapshot is written. `collected` has one entry per finished task: its `{domain, rank}[]` (SERP) or its `MarketAd[]` (ADS, at most 4). `nextCheckAt` is both the poll throttle and the lease (see below).
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
| POST | `/ads/accounts/{accountId}/campaigns` `{name, dailyBudget, objective? (Meta, required), google? (Google, required)}` | Create, always PAUSED → 201 `{id}`. Google: `google` spec, `objective` is 422; Meta: `google` is 422. See [Google campaign builder](#google-campaign-builder) |
| GET | `/ads/accounts/{accountId}/targeting/locations?q=<2-60>` or `?ids=2276,2840` | Google only (Meta is 404): `{locations: {id, name, canonicalName, targetType, countryCode}[]}`, at most 20 enabled Google locations. Send exactly one of `q` (letters, digits, spaces and `.,-()`) or `ids` (1-25 digit ids), else 422. See [Targeting lookups](#targeting-lookups) |
| GET | `/ads/accounts/{accountId}/targeting/languages` | Google only (Meta is 404): `{languages: {id, code, name}[]}`, targetable languages sorted by name |
| GET / PUT | `/ads/market` | Market profile |
| GET | `/ads/market/keywords` | Trending keywords (volume, 12-month trend, competition, CPC range) |
| GET | `/ads/market/ads` | `{status: ready\|gathering\|failed, ads, fetchedAt}`: search competitors for the profile keywords → their recent ads with `preview_image`, format, first/last shown. Clients poll every ~20s while `gathering` |

### Market ads job

The ads endpoint drives a job; there is no cron. Each call moves it one step:

1. A snapshot under 24h old for the current profile key: `ready`.
2. Otherwise the stale snapshot's ads (or `[]`, `fetchedAt: null`) come back with every `gathering` or `failed`.
3. No job, a job for another profile, or a `FAILED` job older than 1h: claim the row (insert with `skipDuplicates`, or update on the `nextCheckAt` seen), post the SERP tasks, write their ids, `gathering`. DataForSEO refusing every task: `FAILED`. A transport error deletes the claimed row and is raised.
4. A job whose `nextCheckAt` is in the future: `gathering`, DataForSEO is not called. `nextCheckAt` is 20s after the last check.
5. Otherwise claim the check: update on the `nextCheckAt` seen, moving it 90s ahead (a lease longer than any check, so a slow check is not repeated, and a job still posting its tasks is not mistaken for a failed one). Then `task_get` each pending id. Done tasks move to `collected`; failed ones are dropped; tasks still pending after 30 min of the stage are dropped. When none is pending:
   - SERP: rank the competitors; none → empty snapshot, job deleted. Else post one ads task per competitor and move to `ADS`. All refused → `FAILED`. A transport error leaves the lease held, so the stage is retried when it expires.
   - ADS: dedupe and sort, write the snapshot (other keys dropped) and delete the job in one transaction: `ready`.
   - No task of the stage gave a result: `FAILED`.
   A check ends by moving `nextCheckAt` 20s ahead.
6. Every write after the claim matches `{projectId, requestKey, nextCheckAt: <our lease>}`. If it matches nothing, a profile change or an expired lease gave the job to someone else: the request writes nothing more (a snapshot is only written together with its successful job delete) and answers `gathering`.
7. A `FAILED` job under 1h old: `failed`, nothing is reposted. That caps what a broken lookup costs.

Errors map through the existing Composio error classes (`ComposioConfigError` → 503 "not configured", `ComposioApiError`/`ComposioToolError` → 502 with a safe message).

## Google campaign builder

Goal: "New campaign" for Google produces a campaign that can run. Still always created **PAUSED**. Search ships first; Display, sitelinks and callouts follow in the stack below.

### Gap map (Google Ads UI walk, 2026-10-12)

| Google Ads UI step | Decision |
|---|---|
| Objective | Not an API field; not needed |
| Campaign type | Search + Display. PMax, Demand Gen, Video, Shopping later |
| Bidding | Maximize clicks (`target_spend: {}`); the old Manual CPC came from Composio's `MUTATE_CAMPAIGNS` having no such field |
| Networks | Search: Google Search only. Display: Display Network |
| Locations, languages | Geo target constant / language constant ids; empty = all. Web prefills them from the Market profile (DataForSEO `location_code` is the geo target constant id) |
| EU political ads | Unchanged: does not contain |
| Start / end dates | Optional |
| Ad group + keywords | One ad group "Ad group 1"; keywords with BROAD / PHRASE / EXACT |
| Responsive search ad | Final URL, 2 display paths, 3-15 headlines, 2-4 descriptions |
| Sitelinks, callouts | Yes (later PR) |
| Responsive display ad | Yes (later PR), images from Drive |
| Budget | Daily, unchanged |
| Audiences, ad schedule, AI Max, page feeds, promotions, prices, calls, lead forms | Out of scope |

### Contract

```ts
{
  name: string;                // 1-255
  dailyBudget: number;         // > 0, currency precision
  objective?: MetaObjective;   // Meta: required. Google: 422 if sent
  google?: GoogleCampaignSpec; // Google: required. Meta: 422 if sent
}

type GoogleCampaignSpec = {            // discriminated on `type`
  type: "SEARCH";                      // "DISPLAY" is added by its PR
  startDate?: "YYYY-MM-DD";            // sent as `${d} 00:00:00`
  endDate?: "YYYY-MM-DD";              // not before startDate; sent as `${d} 23:59:59`
  locationIds: string[];               // 0-25 digit ids; [] = all countries
  languageIds: string[];               // 0-25 digit ids; [] = all languages
  finalUrl: string;                    // http(s), <= 2048
  keywords: { text: string /* 1-80, <= 10 words */; matchType: "BROAD" | "PHRASE" | "EXACT" }[]; // 1-50
  headlines: string[];                 // 3-15, each 1-30, unique ignoring case (else 422)
  descriptions: string[];              // 2-4, each 1-90
  path1?: string; path2?: string;      // <= 15; path2 needs path1
};
```

Keywords repeating another with the same match type (ignoring case) are dropped, not rejected. Zod covers the documented limits; Google stays the authority for width rules and policy.

### One atomic call

`GOOGLEADS_BATCH_MUTATE` with `partial_failure: false` (Google's `GoogleAdsService.Mutate`): every operation is applied or none is, so there is no rollback code. Negative temporary ids link the resources: budget `-1`, campaign `-2`, ad group `-3`. Each `mutate_operations` item has exactly one key:

1. `campaign_budget_operation`: unique name (`<name> budget <8 hex>`), STANDARD, not shared.
2. `campaign_operation`: PAUSED, `advertising_channel_type: SEARCH`, `target_spend: {}`, Google Search network only, `contains_eu_political_advertising`, `start_date_time` / `end_date_time` (`YYYY-MM-DD HH:MM:SS`, account time zone).
3. `campaign_criterion_operation` per location (`geoTargetConstants/<id>`) and language (`languageConstants/<id>`).
4. `ad_group_operation`: `Ad group 1`, ENABLED, `SEARCH_STANDARD`.
5. `ad_group_criterion_operation` per keyword, ENABLED.
6. `ad_group_ad_operation`: ENABLED, `final_urls`, `responsive_search_ad`.

The campaign id is the id in the campaign result's resource name (`mutate_operation_responses[].campaign_result`). A `partial_failure_error` or a missing campaign result means nothing was applied (502). Only the campaign is PAUSED; enabling it later makes everything serve.

### Targeting lookups

The ids for `locationIds` and `languageIds` come from two read-only GAQL queries (`GOOGLEADS_SEARCH_STREAM_GAQL`, run in the account's customer):

- Locations: `geo_target_constant` with `status = 'ENABLED'`, `LIMIT 20`. `q` adds `name LIKE '%<q>%'` and `ORDER BY name`; `ids` adds `id IN (…)`.
- Languages: `language_constant WHERE targetable = TRUE`, sorted by name in code.

`q` is interpolated into the GAQL string. That is safe only because the input is restricted to letters (any script), marks, digits, spaces and `.,-()`: no quote, `%`, `_` or backslash. Core checks this in the route schema and again before building the query; ids must be digits only. Keep the pattern tight.

Check live on the preview: whether GAQL `LIKE` is case-sensitive here (does "berlin" find "Berlin"?). The tests only pin the query text, and the result decides whether the query needs a case-insensitive form.

### Errors

- A Google validation or policy failure (the Composio tool error carries a `GoogleAdsFailure`, e.g. "Too long.", "Destination not working") is **422 with Google's first error message**. The message is read from the tool error text (Core keeps its first 2000 characters, enough for Google's envelope), matched on the text because a long failure can still be cut. Authentication, authorization, quota, internal and transient (concurrent modification, database) failures stay provider errors (502).
- Authentication, authorization, quota and internal Google errors, and transport errors, keep the usual mapping (502, 503 for missing configuration). Other routes are unchanged.
- Account rules (422): Google account without `google`, Google account with `objective`, Meta account with `google`, Meta account without `objective`.

## Web (`apps/web/src/app/(app)/ads`)

- Sidebar item "Ads" (lucide `Megaphone`) in `menu-items.tsx`, gated like Social, project-scoped via `project-scope-href.ts`.
- You page: "Ads" row in `you-page.client.tsx`, same gate passed from `you-page-content.tsx`.
- `/ads?projectId=…&tab=campaigns|market|accounts`. Template: `(app)/social/`.
- Accounts: connect via `useComposioOAuthPopup`, pick accounts, disconnect.
- Campaigns: table on desktop, stacked rows on mobile; range switch; pause/resume and budget with confirm; "New campaign" sheet.
- Market: profile form (keywords, country, language); trending keywords list; ads gallery of `preview_image` cards.
- Ad preview images are Google-hosted URLs (https, from DataForSEO); render them with a plain `<img>` and `referrerPolicy="no-referrer"`, not `next/image`.
- Calm UI per DESIGN.md: one accent, typography over boxes, empty/loading/error states, en/de/es messages.

## Out of scope / follow-ups

- Meta Ad Library (direct Graph API `ads_archive`, EU markets).
- Ad set / ad / creative management (Meta), and editing ad groups or ads after create (Google).
- PMax, Demand Gen, Video, Shopping campaigns.
- Conversion-based bidding, audiences, ad schedule, campaign-total budgets.
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
| 13 | `ads/13-core-market-ads-async` | Core | Market ads as a queued DataForSEO job polled by the page |
| 14 | `ads/14-web-market-gathering` | Web | Market ads gathering, refreshing and failed states |
| 15 | `ads/15-core-google-search-create` | Core | Atomic BATCH_MUTATE create: Search type, keywords, RSA, location / language ids, Maximize clicks, dates, 422 mapping. Deletes the two-step create |
| 16 | `ads/16-core-google-targeting` | Core | Location search / by ids, language list (Google accounts) |
| 17 | `ads/17-core-google-search-assets` | Core | Sitelinks + callouts in the Search tree |
| 18 | `ads/18-core-google-display` | Core | Display type: Drive image refs → image assets → responsive display ad. Drive-ref helper shared with social posts |
| 19 | `ads/19-web-create-page` | Web | Create page (replaces the sheet): basics, dates, keywords (+ from Market), responsive search ad; Meta path |
| 20 | `ads/20-web-targeting` | Web | Location + language pickers, Market defaults |
| 21 | `ads/21-web-search-assets` | Web | Sitelinks + callouts editors |
| 22 | `ads/22-web-display` | Web | Type picker, Display ad editor, image upload / pick |

Ops (no PR): Google Ads developer token + Composio `googleads` auth config; Meta app (ads_read, ads_management, App Review, Business Verification) + Composio `metaads` auth config; DataForSEO account + Composio platform connection.
