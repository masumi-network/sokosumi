# Ads Management

Last updated: 2026-10-14

## Goal

Let a Project manage its Google Ads and Meta Ads campaigns and see trending ads and keywords in its market, all through Composio. New "Ads" entry in the desktop sidebar; on mobile it is a row on the You page. Beta-gated like Social.

## Decisions (Francis, 2026-09-30)

- **Scope: Project.** Ad accounts connect per Project (brand/client), like Project social connections. Web page uses the existing `?projectId=` project picker.
- **Campaigns v1:** list with metrics, pause/resume, change daily budget, create campaign. Campaign level only (Composio `metaads` has no ad set/ad update tools).
- **Market:** Composio out of the box + DataForSEO. Google ads come from DataForSEO's Google Ads Transparency endpoints, which return `preview_image`. Meta Ad Library is a later ticket (not in Composio; EU-only commercial ads; needs Meta ID verification).
- **Rollout:** beta gate = existing social beta (`utxo` Workspace members), reuse `hasCurrentUserSocialBetaAccess` / `requireSocialBetaAccess`.
- **Safety:** new campaigns are always created **PAUSED**. Budget and status changes need a confirm step in Web.

## Integrations (all via Composio)

| Need                                    | Toolkit / call                                                                                                                                                                                                                                                        | Auth                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Google Ads accounts                     | `GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS`, GAQL on `customer` / `customer_client`                                                                                                                                                                                         | Per-user OAuth; Composio auth config holds our Google Ads developer token |
| Google campaigns + metrics              | `GOOGLEADS_SEARCH_STREAM_GAQL`                                                                                                                                                                                                                                        | same                                                                      |
| Google status / budget                  | `GOOGLEADS_MUTATE_CAMPAIGNS`, `GOOGLEADS_MUTATE_CAMPAIGN_BUDGETS`                                                                                                                                                                                                     | same                                                                      |
| Google create                           | `GOOGLEADS_BATCH_MUTATE` (`partial_failure: false`): budget, PAUSED campaign, criteria, ad group, keywords or display ad in one atomic call; Display images are uploaded first, one `BATCH_MUTATE` call each. See [Google campaign builder](#google-campaign-builder) | same                                                                      |
| Meta ad accounts                        | `METAADS_GET_AD_ACCOUNTS`                                                                                                                                                                                                                                             | Per-user OAuth; our own Meta app (no Composio-managed OAuth)              |
| Meta campaigns + metrics                | `METAADS_LIST_CAMPAIGNS`, `METAADS_GET_INSIGHTS` (level=campaign)                                                                                                                                                                                                     | same                                                                      |
| Meta status / budget                    | `METAADS_UPDATE_CAMPAIGN` (one budget field per call)                                                                                                                                                                                                                 | same                                                                      |
| Meta create                             | `METAADS_CREATE_CAMPAIGN` (objective, `special_ad_categories: []`, `daily_budget`, PAUSED)                                                                                                                                                                            | same                                                                      |
| Trending keywords                       | DataForSEO `POST /v3/keywords_data/google_ads/keywords_for_keywords/live`                                                                                                                                                                                             | One platform DataForSEO connection (basic auth)                           |
| Search competitors                      | DataForSEO queued `POST /v3/serp/google/organic/task_post` (`keyword`, `location_code`, `language_code`, `depth` 10), one task per keyword, all in one request; read with `GET …/organic/task_get/advanced/{id}`                                                      | same                                                                      |
| Competitors' ads (with `preview_image`) | DataForSEO queued `POST /v3/serp/google/ads_search/task_post` (`target` domain, `location_code`, `date_from`/`date_to`, `depth` 40), one task per competitor (≤10), all in one request; read with `GET …/ads_search/task_get/advanced/{id}`                           | same                                                                      |
- Execution of per-user toolkits: reuse the restricted `tool_router` session pattern in `apps/core/src/clients/composio.client.ts` (`getConnectedSocialIdentity`, `publishXPost`): pin toolkit, connected account and an allow-list of tools.
- DataForSEO: one clear path — Composio **proxy execute** on the platform connected account (`COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID`) for all three endpoints (`POST /api/v3/tools/execute/proxy`, no tool session). Parse DataForSEO's documented response with zod. Keywords stay live (one task per request). SERPs and ads are queued tasks: live ones hit 60s timeouts half the time when run in parallel, queued ones are ready in about 2.5 min and cost $0.0006 instead of $0.002. See [Market ads job](#market-ads-job).
- Market ads are the **search competitors'** ads: the 10 domains ranking organically for the keywords (most keywords, then best position), each one's 4 newest Transparency Center ads. Not the paid results: DataForSEO SERPs contain no `paid` items (checked 2026-10-07, incl. "car insurance" desktop + mobile), and the `ads_advertisers` endpoint matches advertiser _names_, not keywords.
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

| Method    | Path                                                                                                                 | Purpose                                                                                                                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET       | `/ads/accounts`                                                                                                      | Connected ad accounts                                                                                                                                                                                                                                             |
| POST      | `/ads/connections/initiate` `{provider}`                                                                             | Composio link → `{redirectUrl, connectionId}`                                                                                                                                                                                                                     |
| POST      | `/ads/connections/finalize` `{connectionId}`                                                                         | Store connection, return `availableAccounts[]`; a grant with no ad accounts is revoked and returns `connection: null`                                                                                                                                             |
| DELETE    | `/ads/connections/{adConnectionId}`                                                                                  | Discard a finalized connection with no attached accounts (picker closed without attaching); 409 if any account is still attached; revoke Composio then delete                                                                                                     |
| POST      | `/ads/accounts` `{adConnectionId, externalAccountIds[]}`                                                             | Attach chosen accounts; already attached accounts are returned unchanged                                                                                                                                                                                          |
| DELETE    | `/ads/accounts/{accountId}`                                                                                          | Detach; revoke the Composio account when its last ad account goes                                                                                                                                                                                                 |
| GET       | `/ads/accounts/{accountId}/campaigns?range=LAST_7_DAYS\|LAST_30_DAYS`                                                | Campaigns + spend, impressions, clicks, CTR, CPC, conversions                                                                                                                                                                                                     |
| GET       | `/ads/accounts/{accountId}/campaigns/{campaignId}?range=LAST_7_DAYS\|LAST_30_DAYS`                                   | One Google campaign's details (Meta account, unknown or removed campaign: 404). See [Campaign details](#campaign-details)                                                                                                                                         |
| PATCH     | `/ads/accounts/{accountId}/campaigns/{campaignId}` `{status?: ACTIVE\|PAUSED, dailyBudget?}`                         | Pause/resume, budget                                                                                                                                                                                                                                              |
| PUT       | `/ads/accounts/{accountId}/campaigns/{campaignId}` `{name, dailyBudget, google}`                                     | Edit an editable Google campaign in one atomic call → 204 (also when nothing changed). See [Editing](#editing)                                                                                                                                                    |
| POST      | `/ads/accounts/{accountId}/campaigns` `{name, dailyBudget, objective? (Meta, required), google? (Google, required)}` | Create, always PAUSED → 201 `{id}`. Google: `google` spec, `objective` is 422; Meta: `google` is 422. See [Google campaign builder](#google-campaign-builder)                                                                                                     |
| GET       | `/ads/accounts/{accountId}/targeting/locations?q=<1-80>` or `?ids=2276,2840`                                         | Google only (Meta is 404): `{locations: {id, name, canonicalName, targetType, countryCode}[]}`, enabled Google locations. Send exactly one of `q` (a place name, any characters) or `ids` (1-25 digit ids), else 422. See [Targeting lookups](#targeting-lookups) |
| GET       | `/ads/accounts/{accountId}/targeting/languages`                                                                      | Google only (Meta is 404): `{languages: {id, code, name}[]}`, targetable languages sorted by name                                                                                                                                                                 |
| GET / PUT | `/ads/market`                                                                                                        | Market profile                                                                                                                                                                                                                                                    |
| GET       | `/ads/market/keywords`                                                                                               | Trending keywords (volume, 12-month trend, competition, CPC range)                                                                                                                                                                                                |
| GET       | `/ads/market/ads`                                                                                                    | `{status: ready\|gathering\|failed, ads, fetchedAt}`: search competitors for the profile keywords → their recent ads with `preview_image`, format, first/last shown. Clients poll every ~20s while `gathering`                                                    |

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

Goal: "New campaign" for Google produces a campaign that can run. Still always created **PAUSED**. Search (with sitelinks and callouts) and Display (with Drive images).

### Gap map (Google Ads UI walk, 2026-10-12)

| Google Ads UI step                                                                | Decision                                                                                                                                                       |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective                                                                         | Not an API field; not needed                                                                                                                                   |
| Campaign type                                                                     | Search + Display. PMax, Demand Gen, Video, Shopping later                                                                                                      |
| Bidding                                                                           | Maximize clicks (`target_spend: {}`); the old Manual CPC came from Composio's `MUTATE_CAMPAIGNS` having no such field                                          |
| Networks                                                                          | Search: Google Search only. Display: Display Network                                                                                                           |
| Locations, languages                                                              | Geo target constant / language constant ids; empty = all. Web prefills them from the Market profile (DataForSEO `location_code` is the geo target constant id) |
| EU political ads                                                                  | Unchanged: does not contain                                                                                                                                    |
| Start / end dates                                                                 | Optional                                                                                                                                                       |
| Ad group + keywords                                                               | One ad group "Ad group 1"; keywords with BROAD / PHRASE / EXACT                                                                                                |
| Responsive search ad                                                              | Final URL, 2 display paths, 3-15 headlines, 2-4 descriptions                                                                                                   |
| Sitelinks, callouts                                                               | Yes: optional on Search                                                                                                                                        |
| Responsive display ad                                                             | Yes: business name, headlines, long headline, descriptions, images from Drive (landscape, square, square logo)                                                 |
| Budget                                                                            | Daily, unchanged                                                                                                                                               |
| Audiences, ad schedule, AI Max, page feeds, promotions, prices, calls, lead forms | Out of scope                                                                                                                                                   |

### Contract

```ts
{
  name: string;                // 1-255
  dailyBudget: number;         // > 0, currency precision
  objective?: MetaObjective;   // Meta: required. Google: 422 if sent
  google?: GoogleCampaignSpec; // Google: required. Meta: 422 if sent
}

type GoogleCampaignSpec = {            // discriminated on `type`
  type: "SEARCH";                      // see the Display member below
  startDate?: "YYYY-MM-DD";            // sent as `${d} 00:00:00`
  endDate?: "YYYY-MM-DD";              // not before startDate; sent as `${d} 23:59:59`
  locationIds: string[];               // 0-25 digit ids; [] = all countries
  languageIds: string[];               // 0-25 digit ids; [] = all languages
  finalUrl: string;                    // http(s), <= 2048
  keywords: { text: string /* 1-80, <= 10 words */; matchType: "BROAD" | "PHRASE" | "EXACT" }[]; // 1-50
  headlines: string[];                 // 3-15, each 1-30, unique ignoring case (else 422)
  descriptions: string[];              // 2-4, each 1-90
  path1?: string; path2?: string;      // <= 15; path2 needs path1
  sitelinks?: { text: string /* 1-25 */; finalUrl: string /* http(s), <= 2048 */; description1?: string; description2?: string /* 1-35, both or neither (else 422) */ }[]; // 0-8, texts unique ignoring case
  callouts?: string[];                 // 0-10, each 1-25, unique ignoring case
};
```

```ts
type GoogleDisplayCampaignSpec = {     // type: "DISPLAY"; same startDate, endDate, locationIds, languageIds, finalUrl
  type: "DISPLAY";
  businessName: string;                // 1-25
  headlines: string[];                 // 1-5, each 1-30, unique ignoring case (else 422)
  longHeadline: string;                // 1-90
  descriptions: string[];              // 1-5, each 1-90
  images: {                            // 2-8 Drive files, each file once
    pathname: string; fileUrl: string; name: string;
    size: number;                      // 1..5_242_880 (5120 KB)
    mimeType: "image/jpeg" | "image/png" | "image/gif";
    role: "LANDSCAPE" | "SQUARE" | "LOGO";  // LOGO = square 1:1 logo, >= 128x128
  }[];                                 // >= 1 LANDSCAPE, >= 1 SQUARE, LANDSCAPE + SQUARE <= 6, LOGO <= 2
};
```

Keywords repeating another with the same match type (ignoring case) are dropped, not rejected. Zod covers the documented limits; Google stays the authority for width rules and policy.

### Display images

The images are Drive files, bound to the active Workspace the way Social post media is (one shared check, `requireWorkspaceDriveFileUrl`): the pathname must be in the Workspace's Drive store (403 for another store, 422 for a pathname that is not a Drive path), and `fileUrl` must be an https Vercel Blob URL of exactly that pathname (400). All refusals happen before Google is called.

Before the tree, Core, for every image in request order:

1. Downloads it with the shared `downloadDriveFile` (`ssrfSafeFetch`, also used for Social post media; at most 5,242,880 bytes, 20 s). A missing file, a file over the cap or a file not served as `image/jpeg`, `image/png` or `image/gif` is **422 naming the file**. All downloads finish before the first write.
2. Uploads it in a `GOOGLEADS_BATCH_MUTATE` call of its own (`partial_failure: false`, 60 s timeout): one `asset_operation` create with `{name: "<file name> <8 hex>", type: "IMAGE", image_asset: {data: "<base64>"}}`. Separate calls keep each request body to one image (up to about 7 MB encoded). The asset's resource name comes from `mutate_operation_responses[0].asset_result.resource_name`. A Google rejection (aspect ratio, too small) is **422 prefixed with the file name** (`Image "banner.png": <Google's message>`).

Google checks the aspect ratio and pixel size; Core does not read the image. The asset name has a random suffix because Google asset names are unique per customer.

**Orphaned assets.** Image uploads are not part of the atomic call, and Google cannot remove assets. If an upload or the tree fails after earlier uploads, those image assets stay unused in the account. They serve nothing and cost nothing, and there is no retry or cleanup. Uploading the same image again may create another asset (unverified).

### One atomic call

`GOOGLEADS_BATCH_MUTATE` with `partial_failure: false` (Google's `GoogleAdsService.Mutate`): every operation is applied or none is, so there is no rollback code. Negative temporary ids link the resources: budget `-1`, campaign `-2`, ad group `-3`. Each `mutate_operations` item has exactly one key:

1. `campaign_budget_operation`: unique name (`<name> budget <8 hex>`), STANDARD, not shared.
2. `campaign_operation`: PAUSED, `advertising_channel_type: SEARCH | DISPLAY`, `target_spend: {}`, `contains_eu_political_advertising`, `start_date_time` / `end_date_time` (`YYYY-MM-DD HH:MM:SS`, account time zone). Search sets `network_settings` to Google Search only; Display sends none (Display Network).
3. `campaign_criterion_operation` per location (`geoTargetConstants/<id>`) and language (`languageConstants/<id>`).
4. `ad_group_operation`: `Ad group 1`, ENABLED, `SEARCH_STANDARD` | `DISPLAY_STANDARD`.
5. Search: `ad_group_criterion_operation` per keyword, ENABLED.
6. `ad_group_ad_operation`: ENABLED, `final_urls`, and `responsive_search_ad` (Search) or `responsive_display_ad` (Display: `marketing_images` (LANDSCAPE), `square_marketing_images` (SQUARE), `square_logo_images` (LOGO, omitted without logos; `logo_images` is for 4:1 landscape logos, which we do not send), each `[{asset: "customers/<cid>/assets/<id>"}]`, plus `headlines`, `long_headline`, `descriptions`, `business_name`).
7. Search only, sitelinks and callouts (none when omitted): an `asset_operation` per asset (`sitelink_asset` with `final_urls`, or `callout_asset`; temporary ids `-10`, `-11`, …), then a `campaign_asset_operation` per asset (`field_type` `SITELINK` / `CALLOUT`) linking it to the campaign.

The campaign id is the id in the campaign result's resource name (`mutate_operation_responses[].campaign_result`). A `partial_failure_error` or a missing campaign result means nothing was applied (502). Only the campaign is PAUSED; enabling it later makes everything serve.

### Targeting lookups

The ids for `locationIds` and `languageIds` come from two lookups:

- Locations: Google's `POST https://googleads.googleapis.com/v23/geoTargetConstants:suggest`, called through the Composio proxy (`/api/v3/tools/execute/proxy`) with the ad account's connected account. Body `{locale: "en", locationNames: {names: [q]}}` for `q`, or `{locale: "en", geoTargets: {geoTargetConstants: ["geoTargetConstants/<id>", …]}}` for `ids`. Verified live: matching is case-insensitive ("müNCHEN" finds Munich) and Google ranks the suggestions (Core keeps that order). It is not customer-scoped (no customer id, no `login-customer-id`), so it works for any connected Google login. The proxy answers `{data, status, headers}`; a `status` outside 2xx is a provider error (502).
- Core keeps `status = ENABLED` suggestions, drops repeats of an id and caps a `q` search at one page of suggestions (`GOOGLE_MAX_LOCATION_SUGGESTIONS`). An `ids` lookup returns every id found.
- Languages: GAQL `language_constant WHERE targetable = TRUE` (`GOOGLEADS_SEARCH_STREAM_GAQL`, in the account's customer), sorted by name in code.

The suggest body is JSON, so `q` needs no character whitelist.

### Errors

- A Google validation or policy failure (the Composio tool error carries a `GoogleAdsFailure`, e.g. "Too long.", "Destination not working") is **422 with Google's first error message**. The message is read from the tool error text (Core keeps its first 2000 characters, enough for Google's envelope), matched on the text because a long failure can still be cut. Authentication, authorization, quota, internal and transient (concurrent modification, database) failures stay provider errors (502).
- Authentication, authorization, quota and internal Google errors, and transport errors, keep the usual mapping (502, 503 for missing configuration). Other routes are unchanged.
- The status/budget `PATCH` maps Google failures the same way: a validation or policy failure on its budget or status write is 422 with Google's message, not 502.
- A Display image outside the active Workspace's Drive is 403 / 422 / 400 (see [Display images](#display-images)); one that cannot be downloaded or has the wrong served type is 422 naming the file.
- Account rules (422): Google account without `google`, Google account with `objective`, Meta account with `google`, Meta account without `objective`.

## Campaign details

`GET /ads/accounts/{accountId}/campaigns/{campaignId}?range=` (default `LAST_30_DAYS`): one Google campaign, read-only. A Meta account (even with an inactive connection), an unknown campaign and a REMOVED campaign are 404; an inactive connection is 409, as for the list; `campaignId` is 1-20 digits (422 otherwise), because it goes into GAQL. Response (`AdCampaignDetails`):

- `campaign`: `id`, `name`, `status` (maps like the list: `ACTIVE` / `PAUSED` / `ENDED` / `OTHER`, using `campaign.serving_status`), `type` (`SEARCH` | `DISPLAY` | `OTHER`), `channelType` (raw), `dailyBudget` (micros ÷ 1e6), `currency` (the ad account's), `biddingStrategyType` (raw), `startDate` / `endDate` (`YYYY-MM-DD`, the date part of `start_date_time` / `end_date_time`; null when unset, Google's "no end" `2037-12-30` is null), `started` (start date is today or earlier in `customer.time_zone`), `editable`, `notEditableReason`.
- `editable`: type is Search or Display, else `TYPE`; exactly one non-removed ad group, else `AD_GROUPS`; exactly one non-removed ad in it, a responsive search ad (Search) or responsive display ad (Display), else `AD_TYPE`. The first failing rule wins.
- `targeting`: `locations` (`GoogleLocation`: `id`, `name`, `canonicalName`, `targetType`, `countryCode`, the last two null when Google omits them) and `languages` (`GoogleLanguage`: `id`, `code`, `name`), as the targeting endpoints return them, from the non-negative, non-removed campaign criteria; empty means all countries / languages.
- `keywords`: Search campaigns only (`[]` for any other type): positive, non-removed keywords under non-removed ad groups (`id`, `text`, `matchType`, `status`, `approvalStatus`). A keyword with an unknown match type is skipped.
- `ad`: the campaign's only non-removed ad; null when it has none or several. `search` (RSA: `headlines`, `descriptions`, `path1`, `path2`) or `display` (RDA: `businessName`, `headlines`, `longHeadline`, `descriptions`, `images` as `{assetId, role, url, width, height}`); any other ad type has neither. Image roles: `marketing_images` LANDSCAPE, `square_marketing_images` SQUARE, `square_logo_images` LOGO (`logo_images` is ignored); an image whose asset is gone is skipped.
- `sitelinks`, `callouts`: ENABLED campaign assets only.
- `performance`: `totals` (same fields, rounding and nulls as a campaign list row) and `daily` (`date`, `spend`, `impressions`, `clicks`, `conversions`): the N days before today in the customer's time zone, oldest first, zero-filled.

Read with `GOOGLEADS_SEARCH_STREAM_GAQL` in one session. Queries 1, 2, 4-6, 8 and 9 run in parallel (`X` = campaign id); 3 and 7 follow because they need ids from 2 and 6:

1. `campaign` (+ `customer.time_zone`, `campaign.serving_status`, `campaign_budget.amount_micros`, bidding strategy, start / end date time) `WHERE campaign.id = X AND campaign.status != 'REMOVED'`; no row is 404.
2. `campaign_criterion` (type, location, language, `language_constant.id/code/name`) `WHERE campaign.id = X AND negative = FALSE AND status != 'REMOVED' AND type IN ('LOCATION', 'LANGUAGE')`.
3. Only with locations: `geo_target_constant` (id, name, canonical name, target type, country code) `WHERE resource_name IN (…)`, put back in criterion order.
4. `ad_group WHERE campaign.id = X AND status != 'REMOVED'`: counted for `editable`.
5. `ad_group_criterion` (keyword text, match type, status, approval status) `WHERE campaign.id = X AND type = 'KEYWORD' AND negative = FALSE AND status != 'REMOVED' AND ad_group.status != 'REMOVED'`. Run for every type; the result is dropped unless the campaign is Search.
6. `ad_group_ad` (status, ad strength, policy summary, ad id / type / final URLs, responsive search and display fields) `WHERE campaign.id = X AND status != 'REMOVED' AND ad_group.status != 'REMOVED'`.
7. Only with display images: `asset` (resource name, id, `image_asset.full_size` url / width / height) `WHERE resource_name IN (…)`.
8. `campaign_asset` (`field_type IN ('SITELINK', 'CALLOUT')`, `status = 'ENABLED'`) with the asset's link text, descriptions, final URLs, callout text and approval status.
9. `campaign` with `segments.date`, cost, impressions, clicks, conversions `DURING LAST_7_DAYS | LAST_30_DAYS`; days without a row are zero.

### Editing

`PUT /ads/accounts/{accountId}/campaigns/{campaignId}` `{name, dailyBudget, google}` edits a Google campaign that is `editable` (see above) to match the request. `google` is the create spec (`GoogleCampaignEditSpec`, same limits and refinements) except that Display `images[]` items may also be `{assetId, role}`: keep that image of the ad (a Drive file, as in a create, uploads a new one). Role counts and "each image once" apply to the combined list. It replaces every field; only what differs from the campaign's current state is sent. Status is not part of it (use the `PATCH`). The status `PAUSED` / `ENABLED` stays as it is; Search sitelinks and callouts that the request omits are unlinked.

Responses: 204, also when nothing differs (then no mutate call is made). 404: Meta account (checked before the connection), unknown or REMOVED campaign. 409 `Campaign can't be edited here` when the current campaign is not editable (re-checked at save time), or 409 for an inactive connection as elsewhere. 422: validation; a changed amount on a shared budget (`This campaign uses a shared budget; change it in Google Ads`, 422 here so the edit page shows it; the status/budget `PATCH` keeps its 409); `google.type` is not the campaign's type; an explicit `startDate` that differs while `started` (`The start date can't change after the campaign started`); a kept `assetId` is not one of the ad's current images; a Google validation or policy failure (Google's first message, as in a create). Other provider failures are 502. All refusals except Google's happen before the first write.

Core reads the campaign with the details queries (same session, no metrics query; the campaign query also reads `campaign.campaign_budget` and `campaign_budget.explicitly_shared`, the criteria query `criterion_id`), refuses, uploads new Display images (one `BATCH_MUTATE` call each, as in a create), then sends ONE `GOOGLEADS_BATCH_MUTATE` (`partial_failure: false`) with the operations below, ordered removals, updates, creations. Compared exactly (strings, ordered lists) unless noted; `X` = campaign id, `C` = customer id.

| What                 | Operation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name                 | `campaign_operation.update` `{resource_name: customers/C/campaigns/X, name}`, `update_mask: "name"`                                                                                                                                                                                                                                                                                                                                                                                              |
| Start / end date     | same operation, `start_date_time` `YYYY-MM-DD 00:00:00`, `end_date_time` `YYYY-MM-DD 23:59:59` (as in a create); mask `startDateTime` / `endDateTime`. An omitted `startDate` keeps the current start date; an omitted `endDate` removes the end date by sending Google's far-future `2037-12-30 23:59:59` (what Google reports for "no end"). Masks list only changed fields                                                                                                                    |
| Budget               | `campaign_budget_operation.update` `{resource_name: campaign.campaign_budget, amount_micros}`, mask `amountMicros` (422 on a shared budget, see below)                                                                                                                                                                                                                                                                                                                                           |
| Locations, languages | immutable: removed ids `campaign_criterion_operation.remove` `customers/C/campaignCriteria/X~<criterionId>`; added ids created as in a create. Matched by constant id; a repeated id counts once                                                                                                                                                                                                                                                                                                 |
| Keywords (Search)    | immutable: removed `ad_group_criterion_operation.remove` `customers/C/adGroupCriteria/<adGroupId>~<criterionId>`; added created as in a create. Key = match type + lower-cased trimmed text (the create dedupe)                                                                                                                                                                                                                                                                                  |
| Ad                   | `ad_operation.update` `{resource_name: customers/C/ads/<adId>, final_urls?, responsive_search_ad? \| responsive_display_ad?}` with a mask of the changed fields only, e.g. `finalUrls,responsiveSearchAd.headlines`. Repeated fields are replaced whole; a removed `path1` / `path2` is in the mask only (clears it). Display images: `marketingImages`, `squareMarketingImages`, `squareLogoImages` as `[{asset: customers/C/assets/<id>}]` from the kept and the newly uploaded ones, per role |
| Sitelinks, callouts  | assets cannot be removed and a shared asset would change other campaigns, so they are matched by content (sitelink: text, final URL, both descriptions; callout: text; case-sensitive). Unchanged: nothing. Current one missing from the request: `campaign_asset_operation.remove` `customers/C/campaignAssets/X~<assetId>~SITELINK\|CALLOUT`. New or changed: `asset_operation.create` under a temporary id, then `campaign_asset_operation.create`, as in a create                            |

`update_mask` is a comma-separated FieldMask in the proto3 JSON form (lowerCamelCase, dots for nested fields). Field values in `update` keep snake_case keys, as in the create operations.

Images uploaded for an edit stay unused in the account when the update then fails (assets cannot be removed); an edit repeated after a failure uploads them again.

## Web (`apps/web/src/app/(app)/ads`)

- Sidebar item "Ads" (lucide `Megaphone`) in `menu-items.tsx`, gated like Social, project-scoped via `project-scope-href.ts`.
- You page: "Ads" row in `you-page.client.tsx`, same gate passed from `you-page-content.tsx`.
- `/ads?projectId=…&tab=campaigns|market|accounts`. Template: `(app)/social/`.
- Accounts: connect via `useComposioOAuthPopup`, pick accounts, disconnect.
- Campaigns: Schedules-style row cards. When the project has two or more accounts, the account switch sits on the tab row with the range and New campaign. Pause, resume, and budget still confirm from the row menu. New campaign opens a modal in the same shell as New task and New schedule.
- New campaign wizard. There is no `/ads/campaigns/new` page. Google steps are Campaign type, Basics, Targeting, Keywords (Search only), Ad, and Review. Display skips Keywords. Next checks that step before it moves on. The type cards say what Search and Display need. Review shows one simulated Search or Display ad, including another combination of its texts and images, then Create campaign. Meta is Basics, then Review (name, budget, objective). Core's 422 message (Google's own wording) shows above the form with the input kept. 409 links to Accounts. Optional sitelinks and callouts open when a check finds a refusal inside them, including a later check that still refuses them.
- Details page `/ads/campaigns/{campaignId}?projectId=…&accountId=…&range=7d|30d` (Google accounts only; the campaign row links the name). Same beta gate; a lost project or account, a Meta account, Core 404 and 422 are a 404, 409 asks to reconnect in Accounts. Header (name; type · status · budget · dates) with the pause/resume/budget menu, then Performance (range toggle, totals, daily bar chart of spend/clicks/impressions/conversions with a hidden table), Settings, Targeting, Keywords (Search), the Ad, Sitelinks and Callouts. An **Edit** button next to the menu (only when `editable`) opens the edit modal over the page.
- Edit modal `/ads/campaigns/{campaignId}/edit?projectId=…&accountId=…&range=…`. From the details page, `@modal/(.)edit` opens it over them, like Task edit. A direct link shows the same modal on its own and gives the page its breadcrumb (Ads › campaign › Edit). Both render `AdsCampaignEdit` (`campaigns/campaign-edit.tsx`), with the same gating and errors as the details page (beta, project, Google account, 404/409/other). A campaign that is not `editable`, or one that failed to load, shows why inside the modal. Otherwise it is `EditGoogleCampaignWizard`: the create wizard without Campaign type (the type can't change), so Basics, Targeting, Keywords (Search), Ad and Review. Every step opens from the bar, and Save changes is on Review. It is filled from the details by `googleFormValuesFromDetails` (`lib/ads/google-form-values.ts`; keywords as Google-syntax lines, sitelinks, callouts, Display images as kept images). The start date is read-only once `started` and left out of the `PUT` by the edit spec mapper (Core keeps it); a cleared end date is left out (Core removes the end date). Display images: the ad's current ones are kept `{assetId, role}` with Google's URL as thumbnail and can be removed; new ones upload or come from Drive as in a create. Review says "Saving sends the ad back to Google's review." Save → `editAdCampaign` → toast, back to the details page with the same query; 422 shows Core's message; a 409 saying "Campaign can't be edited here" shows "This campaign can't be edited here.", any other 409 (an inactive connection) asks to reconnect in Accounts. Closing goes back to the details the same way; the modal can't be dismissed while saving.
- Google type picker: one form (`GoogleCampaignWizard` in `ads-campaign-wizard.tsx`) holds the fields of both types and judges only the shown one (a zod schema per type, chosen by `type`). Switching keeps name, budget, dates, targeting and final URL; the Search ad's texts and the Display ad's texts are separate fields, so neither is lost or cut to the other's limits. Switching clears the other type's refusals.
- Search: Keywords (one textarea, `kw` broad, `"kw"` phrase, `[kw]` exact, live count; "Add from Market", shown when the project has a Market profile, loads the trending keywords on click (never with the page: a cold cache is a paid DataForSEO call) and appends them as broad lines up to 50) and the responsive search ad (final URL, display paths, 3-15 headlines, 2-4 descriptions with counters, optional sitelinks and callouts).
- Display: the responsive display ad: final URL, business name (25), 1-5 headlines (30), long headline (90), 1-5 descriptions (90), counters on each, then images and logos (below). Text limits are read from the generated Core schema (`GOOGLE_DISPLAY_LIMITS`).
- Display images (`ads-display-images.tsx`, rules in `lib/ads/google-display-images.ts`): an "Images" slot and a "Logo" slot, each with "Upload" (file input, multiple) and "Choose from Drive" (`DriveFilePicker`), thumbnails (`FileChipMiniPreview`, alt = file name) with their role and a remove button. Images must be Drive files in the active Workspace (Core binds them there): an upload goes to the Workspace's Drive with `uploadDriveFile`, as Social posts do, and a picked file is used as it is. The role comes from the picture's natural size, read in the browser, never from the reader:
  - Images slot: ratio within 1% of 1.91:1 and at least 600 x 314 is LANDSCAPE; within 1% of 1:1 and at least 300 x 300 is SQUARE; any other ratio is refused with both required ratios and minimum sizes, a right ratio under its minimum with that minimum.
  - Logo slot: ratio within 1% of 1:1 and at least 128 x 128 is LOGO; anything else is refused.
  - Also refused, before any upload: a type other than JPEG, PNG or GIF (a Drive file is judged by its extension), a file over 5120 KB, a picture the browser cannot read, more than 6 landscape and square images together, more than 2 logos. A file already added is caught by its Drive pathname, so a re-upload is refused after it lands in Drive.
  - The counts read "Landscape 1 · Square 1 · 2 of 6 images"; the hint "Add at least one landscape and one square image" (or just the missing one) turns into the refusal on a submit without them; the submit is disabled ("Uploading images…") while any picture is being read or uploaded. Core's width and policy checks stay the authority: its 422 shows above the form with the images kept.
  - The 1% ratio tolerance (Google's for marketing, square and logo images) and the size minimums are written in Web (`DISPLAY_IMAGE_RULES`) because the Core schema states them only in prose; the file size cap and types are read from the schema.
- Market: profile form (keywords, country, language); trending keywords list; ads gallery of `preview_image` cards.
- Ad preview images are Google-hosted URLs (https, from DataForSEO); render them with a plain `<img>` and `referrerPolicy="no-referrer"`, not `next/image`.
- Calm UI per DESIGN.md: one accent, typography over boxes, empty/loading/error states, en/de/es messages.

## Out of scope / follow-ups

- Meta Ad Library (direct Graph API `ads_archive`, EU markets).
- Ad set / ad / creative management (Meta), and editing ad groups or several ads (Google; one ad group with one ad is edited).
- PMax, Demand Gen, Video, Shopping campaigns.
- Conversion-based bidding, audiences, ad schedule, campaign-total budgets.
- Apple app.

## Stack

Plain branches, each based on the one below. Draft PRs. Before every PR: `code-review` (Standards + Spec vs this spec and the Sokosumi task).

**Collapse (2026-10-13):** layers **01–05** reviewed and folded into `#5528` (`ads/05-core-campaigns-create` → `main`). Closed: `#5506`, `#5521`, `#5522`, `#5526`.

| #   | Branch                             | Layer | Scope                                                                                                                                             |
| --- | ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | `ads/01-core-schema`               | Core  | ~~Prisma models + migration, env vars, ads provider config, CONTEXT.md glossary, this spec~~ → folded into 05                                     |
| 02  | `ads/02-core-connect`              | Core  | ~~Initiate / finalize / attach / list / detach ad accounts~~ → folded into 05                                                                     |
| 03  | `ads/03-core-campaigns-read`       | Core  | ~~List campaigns + metrics (Google GAQL, Meta insights)~~ → folded into 05                                                                        |
| 04  | `ads/04-core-campaigns-update`     | Core  | ~~Pause/resume, daily budget~~ → folded into 05                                                                                                   |
| 05  | `ads/05-core-campaigns-create`     | Core  | Create campaign (PAUSED) + collapsed 01–04 (current bottom PR)                                                                                    |
| 06  | `ads/06-core-market-keywords`      | Core  | Market profile + trending keywords (DataForSEO, 24h cache)                                                                                        |
| 07  | `ads/07-core-market-ads`           | Core  | Market ads with preview images (DataForSEO, 24h cache)                                                                                            |
| 08  | `ads/08-web-shell`                 | Web   | Sidebar + You entry, `/ads` page shell, tabs, empty states, core snapshot                                                                         |
| 09  | `ads/09-web-accounts`              | Web   | Connect / pick / disconnect ad accounts                                                                                                           |
| 10  | `ads/10-web-campaigns`             | Web   | Campaign list, pause/resume, budget                                                                                                               |
| 11  | `ads/11-web-campaign-create`       | Web   | New campaign sheet                                                                                                                                |
| 12  | `ads/12-web-market`                | Web   | Market profile, trending keywords, ads gallery                                                                                                    |
| 13  | `ads/13-core-market-ads-async`     | Core  | Market ads as a queued DataForSEO job polled by the page                                                                                          |
| 14  | `ads/14-web-market-gathering`      | Web   | Market ads gathering, refreshing and failed states                                                                                                |
| 15  | `ads/15-core-google-search-create` | Core  | Atomic BATCH_MUTATE create: Search type, keywords, RSA, location / language ids, Maximize clicks, dates, 422 mapping. Deletes the two-step create |
| 16  | `ads/16-core-google-targeting`     | Core  | Location search / by ids, language list (Google accounts)                                                                                         |
| 17  | `ads/17-core-google-search-assets` | Core  | Sitelinks + callouts in the Search tree                                                                                                           |
| 18  | `ads/18-core-google-display`       | Core  | Display type: Drive image refs → image assets → responsive display ad. Drive-ref helper shared with social posts                                  |
| 19  | `ads/19-web-create-page`           | Web   | Create page (replaces the sheet): basics, dates, keywords (+ from Market), responsive search ad; Meta path                                        |
| 20  | `ads/20-web-targeting`             | Web   | Location + language pickers, Market defaults                                                                                                      |
| 21  | `ads/21-web-search-assets`         | Web   | Sitelinks + callouts editors                                                                                                                      |
| 22  | `ads/22-web-display`               | Web   | Type picker, Display ad editor, image upload / pick                                                                                               |
| 23  | `ads/23-core-campaign-details`     | Core  | Google campaign details: settings, targeting, keywords, ad, sitelinks, callouts, daily performance                                                |

Ops (no PR): Google Ads developer token + Composio `googleads` auth config; Meta app (ads_read, ads_management, App Review, Business Verification) + Composio `metaads` auth config; DataForSEO account + Composio platform connection.
