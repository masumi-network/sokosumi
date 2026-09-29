# Design: publish Social posts to every connected provider

Date: 2026-09-29
Status: approved in chat; pending spec review
Branch: `social-posts-all-providers`
Supersedes the 2026-09-28 draft on this branch: Facebook binds to exactly one
Page, TikTok privacy is chosen at publish time, media parity is up to four
images or one video where the provider allows it, and no `title`/`privacy`
columns are added — YouTube metadata is derived and TikTok's level recorded.

## Problem

Drafting, scheduling, publishing, and the Soko Bot social tools support X only.
`SOCIAL_POST_TEXT_LIMITS` and `SOCIAL_POST_MEDIA_RULES` in `@sokosumi/utils` contain
just `x`, Core's `requireProvider` rejects the rest, and the publisher hardcodes the
X tool slug and `x.com` URLs. All six providers can be connected for identity, but
five of them cannot be posted to.

## Goal

A Project owner can draft, schedule, publish now, and cancel a post on any connected
provider, from Web or via Soko Bot, with provider-appropriate rules, provider-aware
errors, and a published URL when the provider returns one.

## Non-goals

- Fan-out: one post still targets one connection.
- Instagram carousels/stories, TikTok photo posts (URLs must come from a
  TikTok-verified domain), LinkedIn organization authors, Facebook accounts that
  manage zero or multiple Pages, per-provider analytics.
- Live provider calls in CI. Scope/app-review work happens outside this PR.

## External prerequisites (owner, outside this PR)

Each provider needs a Composio auth config carrying publishing scopes, then a
reconnect. Until then the connection stays active for identity but publishing fails
with a clear permission error. Facebook reconnects in any case: the connection now
stores the Page.

| Provider | Scopes to add | Notes |
| --- | --- | --- |
| X | none | Publishing already works. |
| LinkedIn | `w_member_social` | Person author only. |
| Facebook | `pages_show_list`, `pages_manage_posts`, `pages_read_engagement` | Meta App Review; posts go to the one managed Page. |
| Instagram | `instagram_business_content_publish` | Meta App Review; Business/Creator account linked to a Page. |
| TikTok | `video.publish` (and `video.upload`) | Content Posting audit decides whether the most permissive available level is public or `SELF_ONLY`; publishing works either way and records the level used. |
| YouTube | `https://www.googleapis.com/auth/youtube.upload` | Google OAuth verification and quota; production recommends a custom Google app. |

Then recreate the Composio auth configs, update `COMPOSIO_<PROVIDER>_AUTH_CONFIG_ID`
per environment, and reconnect each account.

## Provider matrix

| Provider | Composio tools | Text | Media | Requirement |
| --- | --- | --- | --- | --- |
| X | `TWITTER_CREATION_OF_A_POST` + media upload | ≤280 | 4 images / 1 GIF / 1 video | text or media (unchanged) |
| LinkedIn | `LINKEDIN_REGISTER_IMAGE_UPLOAD` → `LINKEDIN_CREATE_LINKED_IN_POST`; `LINKEDIN_UPLOAD_VIDEO` → `LINKEDIN_CREATE_VIDEO_POST` | ≤3000 | ≤4 images (jpeg/png) or 1 video (mp4) | text required |
| Facebook | `FACEBOOK_CREATE_POST` / `_PHOTO_POST` / `_MULTI_PHOTO_POST` / `_VIDEO_POST` | ≤63206 | ≤4 images (jpeg/png/webp) or 1 video (mp4) | text or media |
| Instagram | `INSTAGRAM_POST_IG_USER_MEDIA` → `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH` | ≤2200 | 1 image (jpeg) or 1 video (mp4/mov) | media required |
| TikTok | `TIKTOK_QUERY_CREATOR_INFO` → `TIKTOK_PUBLISH_VIDEO` → `TIKTOK_FETCH_PUBLISH_STATUS` | ≤2200 | 1 video (mp4) | video required |
| YouTube | `YOUTUBE_UPLOAD_VIDEO` (staged file) | description ≤5000, title derived ≤100 | 1 video (mp4) | video and text required |

Counts, byte caps, and MIME lists are data in the shared rules below. Kinds never mix.

## Shared rules (`packages/utils/src/social-post.ts`)

- `SOCIAL_POST_TEXT_LIMITS`: add `linkedin: 3000`, `facebook: 63206`,
  `instagram: 2200`, `tiktok: 2200`, `youtube: 5000`. `SocialPostProvider` widens
  with the map, which turns the provider on in Core, Web, and the bot at once.
- `SOCIAL_POST_MEDIA_RULES`: one entry per provider. `x` unchanged; new entries cap
  images at 4 (jpeg/png; jpeg only on Instagram), GIFs at 0 outside X, videos at 1
  (mp4; mp4/mov on Instagram), images at 8 MB, videos at 100 MB.
- Requirement flags exposed as data, not a validation framework:
  `textRequired` (linkedin, youtube), `mediaRequired` (instagram, tiktok,
  youtube), `videoRequired` (tiktok, youtube).
- `socialPostMediaKindForMime` and the byte-cap helper take the provider;
  `validateSocialPostMedia(provider, media)` reads the provider's entry. No other
  new validation machinery.

## Data model (no migration)

- `SocialPost.provider` is already a free string; existing rows are `x` and are
  untouched.
- `ProjectSocialConnection.externalAccountId` already stores each provider's
  identity id (Facebook Page id, LinkedIn person id, Instagram IG user id, TikTok
  open id, YouTube channel id); publishing reads it.
- A post's provider is derived from its connection. A draft without a connection
  keeps today's default (`x`) and is re-derived and re-validated when a connection
  is attached; switching the connection to another provider re-validates stored
  text/media and rejects the request when incompatible.
- No `title` or `privacy` columns: YouTube metadata is derived from the post text
  and TikTok's privacy level is selected at publish time and recorded on the
  attempt.

## Core

### Connection identity

- Facebook identity switches from `FACEBOOK_GET_CURRENT_USER` to
  `FACEBOOK_LIST_MANAGED_PAGES` (`fields: id,name`) with the exactly-one rule
  YouTube already uses for channels: zero or multiple Pages fail the connection
  with a clear message. The Page id becomes `externalAccountId`, its name
  `externalHandle`, and the adapter posts to that Page.
- LinkedIn, Instagram, TikTok, and YouTube identity lookups are unchanged.

### Provider adapters

New directory `apps/core/src/clients/social-post-providers/`:

- `types.ts` — `SocialPostPublishContext` (provider, connected account, executor
  user, text, media refs, signal) and `SocialPostPublishResult` (`externalId`,
  `publishedUrl: string | null`, `providerOutcome?: string`).
- `tools.ts` — the generic pieces today inside `composio.client.ts`: restricted
  tool-router session create/delete pinned to one connected account, the execute
  helper with per-tool timeouts and envelope unwrapping, `ComposioToolError` /
  `ComposioPublishOutcomeUnknownError`, and the presigned file-staging helper.
- `x.ts` — the current X flow moved behind the adapter, unchanged.
- `linkedin.ts` — register each image (`LINKEDIN_REGISTER_IMAGE_UPLOAD`, PUT bytes
  to the returned URL), then `LINKEDIN_CREATE_LINKED_IN_POST` with the person
  author built from `externalAccountId` and the resulting image asset URNs; video
  via `LINKEDIN_UPLOAD_VIDEO` (`video_url` = Drive URL) →
  `LINKEDIN_CREATE_VIDEO_POST`.
- `facebook.ts` — `page_id` from `externalAccountId`; text, photos (1 →
  `FACEBOOK_CREATE_PHOTO_POST`, 2–4 → `FACEBOOK_CREATE_MULTI_PHOTO_POST`) from
  public Drive URLs, or video via `file_url`; `permalink_url` becomes
  `publishedUrl`.
- `instagram.ts` — container via `INSTAGRAM_POST_IG_USER_MEDIA` with the public
  Drive URL, then `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH`, whose own polling waits
  for processing.
- `tiktok.ts` — `TIKTOK_QUERY_CREATOR_INFO` picks the most permissive
  `privacy_level` available; `TIKTOK_PUBLISH_VIDEO` with the public Drive video
  URL, caption, and that level; poll `TIKTOK_FETCH_PUBLISH_STATUS` with backoff
  inside the publish budget. The chosen level is recorded on the attempt's
  `providerOutcome`. Once the publish call is initiated, a timeout is an unknown
  outcome — never a blind retry.
- `youtube.ts` — stage the video bytes, then `YOUTUBE_UPLOAD_VIDEO` with title
  (first text line, ≤100), description (full text), empty tags, `categoryId:
  "22"`, `privacyStatus: "public"`.
- `index.ts` — `publishSocialPostToProvider(provider, context)` dispatch.
- Media transport: adapters whose tools accept public URLs (Facebook, Instagram,
  TikTok, LinkedIn video) pass the stored Drive `fileUrl`; file-only adapters (X,
  LinkedIn images, YouTube) download bytes through the existing SSRF-guarded
  helper at the provider's byte caps and stage them through Composio.

### Publisher

- `social-post-publisher.service.ts` becomes provider-agnostic: it claims, leases,
  retries, and settles exactly as today, calls `publishSocialPostToProvider`, and
  writes the adapter's `externalId` / `publishedUrl`. `publisherInclude` gains
  `externalAccountId`; `ClaimedPost` carries `provider`.
- The attempt's `toolSlug` records the create/publish tool that produced the
  `externalId`. `publishedUrl` is no longer built from `x.com` templates in the
  publisher but comes from the adapter (null when the provider returns none).
- Publish-time media re-validation uses the provider's rules; an incompatible
  stored post fails permanently instead of retrying.
- `classifyPublishError` and `ComposioPublishOutcomeUnknownError` stop hardcoding
  X and use the provider's display name.

## Validation

`createSocialPost`, `updateSocialPost`, and `scheduleSocialPost` enforce, per
provider: text limit and text-required, media rules, media/video requirements. A
draft without a connection keeps today's X defaults; the service re-derives the
provider and re-validates when a connection is set, at schedule time, and at
publish time.

Core OpenAPI: the `provider` enum widens to all six; no other request/response
shape changes. Regenerate the Web Core client afterwards
(`pnpm --filter web generate:core:snapshot`).

## Web

- `social/page.tsx`: composer connections become every active connection instead
  of X-only.
- `social-post-composer-dialog.tsx`: per-provider text limit, MIME list, and media
  validation from the shared rules; requirement hints for Instagram (media),
  TikTok/YouTube (video), and LinkedIn/YouTube (text); provider label and icon
  from the existing `social-icons`.
- Post list and calendar event render the post's provider icon instead of the
  hardcoded X one.
- `action.ts` transport caps come from the shared maxes; translations for the new
  labels and errors in `en`/`de`/`es`.

## Soko Bot

- `tool-contracts.ts`: text/media schema caps become max-across-providers; tool
  descriptions drop "X only" and state the per-platform requirements.
- `versions/skills.ts`: the `social-posts` skill is rewritten for all providers
  (requirements; the human-only connection rule stays). Per the
  iterate-by-adding-a-version convention, `v18` includes it and becomes the
  default, recording the behavior change.
- `soko-bot-runtime.service.ts` handlers pass through unchanged.

## Docs

- `docs/coworker/social-posts-api.md` loses the X-only statements and gains the
  provider matrix and the scopes checklist.
- `apps/core/README.md` platform table and statement updated; `.env.example`
  unchanged.
- New ADR recording the all-provider adapter seam, referencing ADR 0042;
  `CONTEXT.md` glossary updated if it claims X-only.

## Testing

- utils: per-provider limit/media tables and the requirement flags.
- Core adapters: one unit suite per provider with a mocked tool-router fetch —
  success, provider refusal, unknown outcome, media argument shapes, TikTok
  privacy selection, Instagram/YouTube metadata.
- Publisher: per-provider happy path and retry; provider-labeled unknown outcome;
  `publishedUrl` per provider.
- Service: per-provider requirement/text/media validation; draft re-validation on
  connection change.
- Bot: contract tests for the updated caps/descriptions; the default version
  includes the updated skill.
- Web: composer validation per provider; the social page passes all active
  connections.
- OpenAPI snapshot regenerated; affected route tests updated.
- Manual: owner connects each provider with publishing scopes and publishes a
  test post per the matrix, plus one scheduled non-X post; the PR carries the
  checklist and results.

## Rollout

- One PR on `social-posts-all-providers`, draft until CI is green; Core and Web
  ship together with the regenerated snapshot.
- A provider is inert until its Composio auth config carries publishing scopes;
  errors name the missing permission instead of an X-only message. Facebook
  requires a reconnect because the connection now stores the Page.
- Follow-ups: Instagram carousels, Facebook multi-Page picker, TikTok photo
  posts, LinkedIn organization authors, per-provider analytics, long-upload
  worker.
