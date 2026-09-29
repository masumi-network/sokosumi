# Design: publish Social posts to every connected provider

Date: 2026-09-28
Status: approved in chat; pending spec review
Branch: `social-posts-all-providers`

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
- Instagram carousels/stories, TikTok photo posts, LinkedIn organization authors,
  Facebook multiple-Page selection (first managed Page only), per-provider analytics.
- Live provider calls in CI. Scope/app-review work happens outside this PR.

## External prerequisites (owner, outside this PR)

Each provider needs a Composio auth config carrying publishing scopes, then a
reconnect. Until then the connection stays active for identity but publishing fails
with a clear permission error.

| Provider | Scopes to add | Notes |
| --- | --- | --- |
| X | none | Publishing already works. |
| LinkedIn | `w_member_social` | Person author only. |
| Facebook | `pages_show_list`, `pages_manage_posts`, `pages_read_engagement` | Meta App Review; posts go to a Page. |
| Instagram | `instagram_business_content_publish` | Meta App Review; Business/Creator account linked to a Page. |
| TikTok | `video.publish` (and `video.upload`) | Content Posting audit for public posts; unaudited apps post `SELF_ONLY`. |
| YouTube | `https://www.googleapis.com/auth/youtube.upload` | Google OAuth verification and quota; production recommends a custom Google app. |

Then recreate the Composio auth configs, update `COMPOSIO_<PROVIDER>_AUTH_CONFIG_ID`
per environment, and reconnect each account.

## Provider matrix

| Provider | Composio tools | Text | Media | Publish shape |
| --- | --- | --- | --- | --- |
| X | `TWITTER_CREATION_OF_A_POST` + media upload | ≤280 | 4 images / 1 GIF / 1 video | Synchronous. |
| LinkedIn | `LINKEDIN_REGISTER_IMAGE_UPLOAD` → `LINKEDIN_CREATE_LINKED_IN_POST` | ≤3000 | optional 1 image | Synchronous. |
| Facebook | `FACEBOOK_CREATE_POST` / `_PHOTO_POST` / `_VIDEO_POST` | ≤63206 | optional 1 photo/video | Synchronous; `permalink_url` returned. |
| Instagram | `INSTAGRAM_POST_IG_USER_MEDIA` → `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH` | ≤2200 | required 1 image/video | Publish tool polls processing. |
| TikTok | `TIKTOK_PUBLISH_VIDEO` (public URL) + `TIKTOK_FETCH_PUBLISH_STATUS` | ≤2200 | required 1 video | Accepted, then provider-side processing. |
| YouTube | `YOUTUBE_MULTIPART_UPLOAD_VIDEO` (staged file) | title ≤100 + description ≤5000 | required 1 video | Upload is the publish. |

## Shared rules (`packages/utils/src/social-post.ts`)

- `SOCIAL_POST_TEXT_LIMITS`: add `linkedin: 3000`, `facebook: 63206`,
  `instagram: 2200`, `tiktok: 2200`, `youtube: 5000`. `SocialPostProvider` widens
  with the map, which turns the provider on in Core, Web, and the bot at once.
- `SOCIAL_POST_MEDIA_RULES`: one entry per provider (counts, byte caps, MIME lists):
  - `linkedin`: 1 image (jpeg/png); no GIF/video in this PR.
  - `facebook`: 1 image (jpeg/png/gif) or 1 video (mp4).
  - `instagram`: 1 image (jpeg/png) or 1 video (mp4/mov).
  - `tiktok`: 1 video (mp4/webm/mov).
  - `youtube`: 1 video (mp4/mov/webm), ≤100 MB.
  - `x`: unchanged.
- `validateSocialPostMedia(provider, media)` reads the provider's entry; no new
  validation framework.
- New tiny predicates used by Core and Web: `socialPostRequiresMedia(provider)`
  (instagram, tiktok, youtube), `socialPostRequiresVideo(provider)` (tiktok,
  youtube), `SOCIAL_POST_TITLE_LIMITS.youtube = 100`,
  `SOCIAL_POST_PRIVACY_VALUES.youtube = ["private", "unlisted", "public"]`.

## Data model (additive migration)

`SocialPost` gains two nullable columns:

- `title String?` — YouTube title; null for other providers.
- `privacy String?` — provider privacy value; YouTube only in this PR
  (`private` default, `unlisted`, `public`). TikTok stays `SELF_ONLY` in the adapter.

No backfill; existing rows read as null.

## Core

### Provider adapters

`apps/core/src/clients/social-post-providers/`:

- `types.ts` — `SocialPostPublishContext` (provider, connected account, executor
  user, text, title, privacy, media refs, signal) and
  `SocialPostPublishResult` (`externalId`, `publishedUrl: string | null`,
  `providerOutcome?: string`).
- `tools.ts` — the generic pieces today living inside `composio.client.ts`:
  tool-router session create/delete pinned to one connected account, an execute
  helper with a per-tool timeout map, envelope unwrapping, and the existing
  `ComposioToolError` / `ComposioPublishOutcomeUnknownError` types.
- `x.ts` — the current X flow moved behind the adapter.
- `linkedin.ts` — register image upload (PUT bytes to the returned URL), then
  `LINKEDIN_CREATE_LINKED_IN_POST` with the person author from
  `LINKEDIN_GET_MY_INFO`; text-only works.
- `facebook.ts` — target Page from the connection; text, photo (`url` from the
  Drive blob), or video; `permalink_url` becomes `publishedUrl`.
- `instagram.ts` — container with the Drive blob URL, then publish; the publish
  tool waits for processing (180 s timeout).
- `tiktok.ts` — `TIKTOK_PUBLISH_VIDEO` with the public Drive video URL and caption;
  poll `TIKTOK_FETCH_PUBLISH_STATUS` with backoff inside the publish budget. A
  returned `publish_id` counts as published (provider processing continues).
- `youtube.ts` — stage the video file through `/files/upload/request`, then
  `YOUTUBE_MULTIPART_UPLOAD_VIDEO` (`categoryId: "22"`, `privacyStatus` from the
  post); 300 s tool timeout; ≤100 MB.
- `index.ts` — `publishSocialPostToProvider(provider, context)` dispatch.

Adapters receive the media refs and decide: bytes for X/LinkedIn/YouTube (staging),
public Drive URL for Facebook/Instagram/TikTok.

### Facebook Page resolution

At connection finalize (and on reconnect), Facebook resolves
`FACEBOOK_LIST_MANAGED_PAGES`; the pages are sorted by id and the lowest-id page's id
and name become the connection's `externalAccountId` and `externalHandle`, and that
page is the post target. Multiple Pages are a documented limitation.

### Publisher

`social-post-publisher.service.ts` becomes provider-agnostic: it claims, leases,
retries, and records attempts exactly as today, calls
`publishSocialPostToProvider`, and writes the adapter's `externalId` / `publishedUrl`.
The attempt's `toolSlug` records the provider's create tool. `publishedUrl` is no
longer built from `x.com` templates in the publisher.

Budget stays 240 s per attempt with the 5-minute lease; YouTube uploads that exceed
it fail transiently with a clear message. A background worker for long uploads is a
follow-up.

## Validation

`createSocialPost`, `updateSocialPost`, and `scheduleSocialPost` enforce, per
provider: text limit, media rules, media/video requirements, YouTube title required
(≤100) and privacy value, TikTok privacy fixed to `SELF_ONLY`. A draft without a
connection keeps today's X defaults and is re-validated when the connection is set,
at schedule time, and at publish time.

Core OpenAPI: `provider` enum widens to all six; add `title` and `privacy`; then
regenerate the Web Core client (`pnpm --filter web generate:core:snapshot`).

## Web

- `social/page.tsx`: composer connections become every active connection instead of
  X-only.
- `social-post-composer-dialog.tsx`: per-provider text limit and media validation
  from the shared maps; media requirement hints for Instagram/TikTok/YouTube;
  YouTube-only title (required) and privacy (default private) fields; media picker
  MIME list from the provider rules.
- Translations for the new labels and errors in `en`/`de`/`es`.
- Calendar social feed needs no code change; non-X posts must render.

## Soko Bot

- `tool-contracts.ts`: `create_social_post` and `update_social_post` gain optional
  `title` and `privacy`; descriptions move from "X" to all providers with media and
  video requirements.
- `versions/skills.ts` `social-posts` skill rewritten (all providers, YouTube
  title/privacy, TikTok `SELF_ONLY`); new version `v18` includes it and becomes the
  default.
- `soko-bot-runtime.service.ts` passes `title`/`privacy` through; the observation
  renderer includes them when present.

## Docs

`docs/coworker/social-posts-api.md` loses the X-only statements, gains the provider
matrix and the scopes checklist. `apps/core/README.md` / `.env.example` stay aligned
with the auth config variables.

## Testing

- utils: per-provider limit/media tables and the new predicates.
- Core adapters: one unit suite per provider with a mocked tool-router fetch —
  success, provider refusal, unknown outcome, media staging.
- Publisher: per-provider happy path and retry; TikTok accepted-then-processing.
- Service: requirement/title/privacy validation per provider; draft re-validation.
- Bot: schema/description contract tests; default version includes the social skill.
- Web: composer validation per provider; social page passes all active connections.
- Manual: owner connects each provider with publish scopes and posts a test; the PR
  carries the checklist and results.

## Rollout

- One PR on `social-posts-all-providers`, draft until CI is green.
- A provider is inert until its auth config has publishing scopes; errors name the
  missing permission instead of an X-only message.
- Follow-ups: Instagram carousels, Facebook Page picker, TikTok privacy/public
  audit, LinkedIn organization posts, analytics, long-upload worker.
