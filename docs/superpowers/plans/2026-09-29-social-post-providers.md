# All-Provider Social Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Social posts to X, LinkedIn, Facebook, Instagram, TikTok, and YouTube through the existing Core scheduling pipeline and Soko Bot tools.

**Architecture:** Per-provider rules become shared data in `@sokosumi/utils`; Core adapters under `apps/core/src/clients/social-post-providers/` translate one publish context into each provider's Composio tool sequence, dispatched from the existing provider-agnostic lease/retry publisher. Web and Soko Bot generalize over the same rules; no schema migration.

**Tech Stack:** TypeScript, Hono/Zod/OpenAPI (Core), Prisma (no migration), Vitest, Next.js 16 + next-intl (Web), Composio tool-router API, pnpm/Turborepo.

**Spec:** `docs/superpowers/specs/2026-09-29-social-post-providers-design.md`

## Global Constraints

- Node.js 24, pinned dependency versions; no new dependencies.
- No Prisma migration. `SocialPost.provider` stays a free string; `ProjectSocialConnection.externalAccountId` stores each provider's identity id.
- Never hand-edit generated artifacts; after the Core schema change run `pnpm --filter @sokosumi/core-client generate:snapshot`, then `pnpm --filter web typecheck`.
- Shared provider labels and rules live once in `packages/utils/src/social-post.ts`; Core, Web, and `@sokosumi/soko-bot` import them.
- Conventional Commit messages; let commit hooks run (`pnpm check && pnpm typecheck`).
- Filtered Core Vitest runs must start with `pnpm --filter @sokosumi/database prisma:generate`.
- No live provider calls in CI. Composio arg shapes follow the toolkit docs captured in the spec; the manual E2E task validates the live workspace.
- Beta gating (`SOCIAL_BETA_ORGANIZATION_SLUG`) and the existing lease/retry/settlement behavior stay untouched.
- Provider errors stay sanitized: never log or store tokens, session ids, or raw payloads; use the existing `sanitizeProviderMessage` / `ComposioToolError` path.
- `packages/utils` exports are added to `src/index.ts`; build the package after export changes.

## Review Focus

Five failure modes the spec implies but no happy-path test covers; each has a test added in its owning task.

1. **Provider cannot fetch a Drive URL** (Instagram/Facebook/TikTok pull the blob themselves): must surface as a provider-labeled rejection with the provider's message, never a silent retry loop — covered by adapter error tests.
2. **TikTok initiated but unconfirmed** (timeout while polling `TIKTOK_FETCH_PUBLISH_STATUS`): must settle as outcome-unknown and never blind-retry — covered by the TikTok timeout test.
3. **Facebook zero/multiple Pages**: connection must fail with a clear message instead of storing a user id that would later post to the wrong target — covered by identity tests.
4. **Provider switch on a draft via `updateSocialPost`**: stored text/media must be re-validated against the new provider and rejected when incompatible — covered by service tests.
5. **Unknown provider string in the DB** (legacy/future row): publisher must fail the attempt permanently with a clear message, never crash the worker — covered by publisher test.

---

### Task 1: Shared per-provider rules in `@sokosumi/utils`

**Files:**
- Modify: `packages/utils/src/social-post.ts`
- Modify: `packages/utils/src/index.ts`
- Test: `packages/utils/src/social-post.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `@sokosumi/utils`):
  - `SOCIAL_POST_TEXT_LIMITS` = `{ x: 280, linkedin: 3000, facebook: 63206, instagram: 2200, tiktok: 2200, youtube: 5000 } as const`
  - `SocialPostProvider` = keyof of the limits map (now the six keys)
  - `SOCIAL_POST_MEDIA_RULES[provider]` with existing keys (`maxImages`, `maxGifs`, `maxVideos`, `maxImageBytes`, `maxGifBytes`, `maxVideoBytes`, `imageMimeTypes`, `gifMimeTypes`, `videoMimeTypes`)
  - `SOCIAL_POST_MEDIA_REQUIREMENTS: Record<SocialPostProvider, "none" | "any" | "video">` — `instagram: "any"`, `tiktok: "video"`, `youtube: "video"`, others `"none"`
  - `SOCIAL_POST_TEXT_REQUIRED: Record<SocialPostProvider, boolean>` — `linkedin: true`, `youtube: true`, others `false`
  - `socialPostProviderLabel(provider: SocialPostProvider): string` — `X`, `LinkedIn`, `Facebook`, `Instagram`, `TikTok`, `YouTube`
  - `socialPostMaxBytesForKind(provider: SocialPostProvider, kind: SocialPostMediaKind): number`
  - `socialPostMediaKindForMime(mime: string): SocialPostMediaKind | null` — unchanged signature; recognizes the union of every provider's MIME lists
  - `validateSocialPostMedia(provider, media)` — unchanged signature; now also rejects a MIME the provider does not accept

Rule values: `x` unchanged; `linkedin` 4 images (`image/jpeg`, `image/png`), 0 GIF, 1 video (`video/mp4`); `facebook` 4 images (`image/jpeg`, `image/png`, `image/webp`), 0 GIF, 1 video (`video/mp4`); `instagram` 1 image (`image/jpeg`), 0 GIF, 1 video (`video/mp4`, `video/quicktime`); `tiktok` 0 images, 0 GIF, 1 video (`video/mp4`); `youtube` 0 images, 0 GIF, 1 video (`video/mp4`). New providers cap images at 8 MB and videos at 100 MB; `maxGifBytes` 0 where GIFs are not accepted. Deviation from spec wording (same behavior, smaller diff): `socialPostMediaKindForMime` stays provider-neutral because kind is a MIME category; the provider's allowed list is enforced inside `validateSocialPostMedia`, and `socialPostMaxBytesForKind` replaces Core's local X-only copy.

- [ ] **Step 1: Write failing tests**

In `packages/utils/src/social-post.test.ts`:
- `it.each` over the six providers asserting the exact `SOCIAL_POST_TEXT_LIMITS` values and both requirement maps.
- `socialPostProviderLabel` returns the exact display names.
- `validateSocialPostMedia`: `instagram` rejects `image/png` and accepts `image/jpeg`; `linkedin`/`facebook` accept four images and reject five; every new provider rejects an image on `tiktok`/`youtube` via `too_many_images`; `instagram`/`facebook` reject two videos (`too_many_videos`); `tiktok` accepts one `video/mp4` and rejects `video/quicktime`; GIFs rejected on every provider except `x`.
- `socialPostMaxBytesForKind`: `instagram` image cap is 8 MB, `tiktok` video cap is 100 MB, `x` keeps its existing caps.
- `socialPostMediaKindForMime("image/webp")` still returns `"image"`; unknown MIME still returns `null`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sokosumi/utils test`
Expected: FAIL on unknown providers/limits.

- [ ] **Step 3: Implement the rules**

Rework `packages/utils/src/social-post.ts`: widen both maps to six providers, add the requirement maps, label helper, and `socialPostMaxBytesForKind`; make `MAX_BYTES` selection provider-aware inside `validateSocialPostMedia`, add a per-kind provider MIME membership check, and make `socialPostMediaKindForMime` consult the union of all providers' lists. Export the new symbols from `packages/utils/src/index.ts` beside the existing social-post exports.

- [ ] **Step 4: Run tests, then build the package**

Run: `pnpm --filter @sokosumi/utils test && pnpm --filter @sokosumi/utils build`
Expected: PASS; `dist` regenerated.

- [ ] **Step 5: Commit**

```bash
git add packages/utils/src/social-post.ts packages/utils/src/social-post.test.ts packages/utils/src/index.ts
git commit -m "feat(utils): add per-provider social post rules and requirements"
```

---

### Task 2: Core schema and service validation per provider

**Files:**
- Modify: `apps/core/src/schemas/social-post.schema.ts`
- Modify: `apps/core/src/services/social-posts.service.ts`
- Test: `apps/core/src/services/social-posts.service.test.ts`
- Test: `apps/core/src/routes/v1/projects/[id]/social-posts/social-posts.routes.test.ts` (update fixtures)

**Interfaces:**
- Consumes: Task 1 rules: `SOCIAL_POST_TEXT_LIMITS`, `SOCIAL_POST_MEDIA_REQUIREMENTS`, `SOCIAL_POST_TEXT_REQUIRED`, `socialPostProviderLabel`, `validateSocialPostMedia`.
- Produces:
  - `socialPostProviderSchema` (`z.enum` of the six provider keys) used by `socialPostSchema.provider`
  - Service behavior: create/update/schedule enforce text limit, text-required, media rules, and media/video requirements per provider; `updateSocialPost` re-derives `provider` when `socialConnectionId` changes and re-validates stored text/media.

- [ ] **Step 1: Write failing service tests**

In `apps/core/src/services/social-posts.service.test.ts`, replace the `it.each(["tiktok","instagram","linkedin","facebook","youtube"])` rejection suite with:
- Acceptance: creating a draft with a connection for each of the five providers stores `provider` and returns it.
- `createSocialPost` with an Instagram connection and no media → 400 naming Instagram; with one JPEG image → accepted.
- `createSocialPost` with a YouTube connection and an image (no video) → 400 requiring a video; with one `video/mp4` → accepted.
- `createSocialPost` with a LinkedIn connection, empty text, and an image → 400 (text required).
- `updateSocialPost` switching a text-only draft (provider `x`) to an Instagram connection → 400 (media required) and the row keeps its previous provider; switching to a LinkedIn connection with non-empty text → succeeds and the row's `provider` becomes `linkedin`.
- `scheduleSocialPost` on a post whose stored media violates its provider's rules → 400.
- Keep: a draft created without a connection keeps provider `x`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sokosumi/database prisma:generate && pnpm --filter @sokosumi/core test social-posts.service`
Expected: FAIL (rejections where acceptance is asserted).

- [ ] **Step 3: Implement schema and service changes**

Schema: build `socialPostProviderSchema` from `Object.keys(SOCIAL_POST_TEXT_LIMITS)` and use it for `socialPostSchema.provider`; set the text `max` to `Math.max(...Object.values(SOCIAL_POST_TEXT_LIMITS))` and the media-array `max` to the max `maxImages` across providers.
Service: use `socialPostProviderLabel` for messages (delete local `providerLabel`); add a `requireMediaRequirement(provider, media)` that rejects `"any"` with no media and `"video"` unless exactly one video is attached; call it from create, update, and schedule after media normalization; apply `SOCIAL_POST_TEXT_REQUIRED` in `requireTextWithinLimit`; in `updateSocialPost` validate stored text/media against the provider of the connection selected by the request and write `data.provider` when it differs.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @sokosumi/core test social-posts`
Expected: PASS. Then `pnpm --filter @sokosumi/core test social-posts.routes` and update any fixture that still asserts an X-only provider.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/schemas/social-post.schema.ts apps/core/src/services/social-posts.service.ts apps/core/src/services/social-posts.service.test.ts "apps/core/src/routes/v1/projects/[id]/social-posts/social-posts.routes.test.ts"
git commit -m "feat(core): validate social posts per provider"
```

---

### Task 3: Adapter seam, publisher dispatch, provider-labeled errors

**Files:**
- Create: `apps/core/src/clients/social-post-providers/types.ts`
- Create: `apps/core/src/clients/social-post-providers/tools.ts`
- Create: `apps/core/src/clients/social-post-providers/published-url.ts`
- Create: `apps/core/src/clients/social-post-providers/x.ts`
- Create: `apps/core/src/clients/social-post-providers/index.ts`
- Create: `apps/core/src/clients/social-post-providers/x.test.ts` (moved from `composio.client.test.ts` `publishXPost` suites)
- Modify: `apps/core/src/clients/composio.client.ts` (remove publish code; export fetch internals)
- Modify: `apps/core/src/clients/composio.client.test.ts` (keep connection/identity suites)
- Modify: `apps/core/src/helpers/social-post-media.ts` (provider-aware)
- Modify: `apps/core/src/helpers/social-post-publish-errors.ts`
- Modify: `apps/core/src/services/social-post-publisher.service.ts`
- Test: `apps/core/src/services/social-post-publisher.service.test.ts`
- Test: `apps/core/src/clients/social-post-providers/published-url.test.ts`

**Interfaces:**
- Consumes: Task 1 rules; existing tool-router fetch helpers.
- Produces:
  - `SocialPostPublishContext` = `{ provider, connectedAccountId, executorUserId, externalAccountId, externalHandle: string | null, text, media: readonly SocialPostMediaRef[], signal?: AbortSignal }`
  - `SocialPostPublishResult` = `{ externalId: string, publishedUrl: string | null, providerOutcome?: string, toolSlug?: string }`
  - `SocialPostMediaBytes` = `{ bytes: Uint8Array<ArrayBuffer>; name: string; mimeType: string; kind: SocialPostMediaKind }`
  - `tools.ts` exports: `createSocialPublishSession({ toolkitSlug, connectedAccountId, executorUserId, toolSlugs, signal }): Promise<string>`, `deleteSocialPublishSession(sessionId, context): Promise<void>`, `executeSocialPublishTool({ sessionId, toolSlug, arguments, context, refused, timeoutMs, signal }): Promise<Record<string, unknown> | null>`, `stageSocialPublishFile({ toolkitSlug, toolSlug, file: SocialPostMediaBytes, signal }): Promise<string>`, plus `ComposioToolError` and `ComposioPublishOutcomeUnknownError` (message uses the provider label).
  - `published-url.ts`: `socialPostPublishedUrl(provider, externalHandle: string | null, externalId: string): string | null` — X builds the existing `x.com` URL, LinkedIn `https://www.linkedin.com/feed/update/{externalId}`, Facebook `https://www.facebook.com/{externalId}`, YouTube `https://www.youtube.com/watch?v={externalId}`, Instagram/TikTok `null`.
  - `x.ts`: `publishXPost(context): Promise<SocialPostPublishResult>` — current behavior; `publishedUrl` from `socialPostPublishedUrl`, `toolSlug` `"TWITTER_CREATION_OF_A_POST"`.
  - `index.ts`: `publishSocialPostToProvider(context): Promise<SocialPostPublishResult>` and `SOCIAL_POST_ATTEMPT_TOOL_SLUGS: Record<SocialPostProvider, string>` covering all six providers now (X `TWITTER_CREATION_OF_A_POST`, LinkedIn `LINKEDIN_CREATE_LINKED_IN_POST`, Facebook `FACEBOOK_CREATE_POST`, Instagram `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH`, TikTok `TIKTOK_PUBLISH_VIDEO`, YouTube `YOUTUBE_UPLOAD_VIDEO`). The dispatch implements the `x` case; other providers throw a clear permanent error until their task adds the case.
  - `downloadSocialPostMedia(provider, media, signal?): Promise<SocialPostMediaBytes[]>` with provider byte caps and provider-labeled errors.
  - Publisher behavior: dispatches by `post.provider`, writes attempt `toolSlug` from the registry (overwritten by `result.toolSlug` when present), writes `publishedUrl` from the result, re-validates stored media with `validateSocialPostMedia` before attempting, and classifies errors with the provider label.

- [ ] **Step 1: Write failing tests**

- `published-url.test.ts`: each provider's URL shape plus `null` for Instagram/TikTok.
- `x.test.ts`: move the `publishXPost` describe blocks from `composio.client.test.ts`; update expected results to the new result object and add a media-upload case asserting the staged `s3key` argument shape is unchanged.
- `social-post-publisher.service.test.ts`: mock `@/clients/social-post-providers` (`publishSocialPostToProvider`) instead of `publishXPost`; assert the dispatch context (provider, `externalAccountId`, `externalHandle`), the attempt `toolSlug` written per provider (add a non-X case), recovery uses the provider URL helper, and a post whose stored `provider` is unknown fails permanently with a clear message (Review Focus 5).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sokosumi/database prisma:generate && pnpm --filter @sokosumi/core test social-post`
Expected: FAIL (new modules missing).

- [ ] **Step 3: Implement**

- Extract the generic session/execute/staging pieces and the two error classes from `composio.client.ts` into `tools.ts`; export `projectComposioFetch`, `projectComposioResponse`, `projectResponseError`, and `record` from `composio.client.ts` for one-way reuse (no cycles: `composio.client.ts` never imports the new directory).
- Move the X publish flow and its tool-slug table into `x.ts`, preserving behavior (restricted session, media staging, processing poll, outcome-unknown rule).
- Add `types.ts`, `published-url.ts`, and the dispatch registry in `index.ts` (all six attempt slugs; only the `x` dispatch case, other providers fail clearly until their task lands).
- Update `social-post-media.ts` to take the provider and use `socialPostMaxBytesForKind` and `socialPostProviderLabel`; update `social-post-publish-errors.ts` so `classifyPublishError(error, providerLabel)` builds provider-labeled summaries.
- Update the publisher: add `externalAccountId` to `publisherInclude`, carry `provider` on `ClaimedPost`, call `publishSocialPostToProvider`, use `SOCIAL_POST_ATTEMPT_TOOL_SLUGS` for the attempt row, set `publishedUrl` from `result`, replace the local `publishedUrl()` helper with `socialPostPublishedUrl` in the lease-recovery branch, and pass the provider label to `classifyPublishError`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @sokosumi/database prisma:generate && pnpm --filter @sokosumi/core test social-post`
Expected: PASS. Run `pnpm --filter @sokosumi/core test composio` to confirm connection/identity suites still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/clients apps/core/src/helpers/social-post-media.ts apps/core/src/helpers/social-post-publish-errors.ts apps/core/src/services/social-post-publisher.service.ts apps/core/src/services/social-post-publisher.service.test.ts
git commit -m "refactor(core): extract social publish adapters and dispatch by provider"
```

---

### Task 4: LinkedIn adapter

**Files:**
- Create: `apps/core/src/clients/social-post-providers/linkedin.ts`
- Create: `apps/core/src/clients/social-post-providers/linkedin.test.ts`
- Modify: `apps/core/src/clients/social-post-providers/index.ts`

**Interfaces:**
- Consumes: Task 3 `SocialPostPublishContext`, `executeSocialPublishTool`, `stage`-style helpers, `socialPostPublishedUrl`; Task 1 rules.
- Produces: `publishLinkedInPost(context): Promise<SocialPostPublishResult>` and registry entry `linkedin: "LINKEDIN_CREATE_LINKED_IN_POST"`.

Sequence: build the author as `urn:li:person:{externalAccountId}`. Images (1–4): for each, `LINKEDIN_REGISTER_IMAGE_UPLOAD` with `{ owner_urn }`, PUT bytes to the returned upload URL through `ssrfSafeFetch`, collect the returned asset URN; then `LINKEDIN_CREATE_LINKED_IN_POST` with `{ author, commentary: text, visibility: "PUBLIC", lifecycleState: "PUBLISHED", images: assetUrns }`. Video: `LINKEDIN_UPLOAD_VIDEO` with `{ video_url: ref.fileUrl }` then `LINKEDIN_CREATE_VIDEO_POST` with `{ video_urn, commentary: text, visibility: "PUBLIC" }`. Text-only: create post without `images`. `externalId` from the create response `id`/`urn`; `publishedUrl` from `socialPostPublishedUrl`; `toolSlug` is the create tool actually used. Arg shapes follow the Composio docs in the spec; if the live create tool rejects asset URNs in `images`, switch to staged file objects `{ name, mimetype, s3key }` via `stageSocialPublishFile` and update the fixture in the same task.

- [ ] **Step 1: Write failing tests** in `linkedin.test.ts` with a mocked tool-router fetch: session enables the four LinkedIn tools; a text-only publish passes author/commentary and returns the URN-derived URL; a two-image publish registers twice, PUTs bytes to each upload URL, and passes both asset URNs; an image-register refusal maps to `ComposioToolError` with the provider message (Review Focus 1); a video publish passes `video_url` and the returned URN.
- [ ] **Step 2: Run:** `pnpm --filter @sokosumi/database prisma:generate && pnpm --filter @sokosumi/core test social-post-providers/linkedin` — FAIL.
- [ ] **Step 3: Implement `linkedin.ts` and add the dispatch case.**
- [ ] **Step 4: Run:** same command — PASS.
- [ ] **Step 5: Commit:** `feat(core): publish social posts to LinkedIn`.

---

### Task 5: Facebook adapter and Page-bound identity

**Files:**
- Create: `apps/core/src/clients/social-post-providers/facebook.ts`
- Create: `apps/core/src/clients/social-post-providers/facebook.test.ts`
- Modify: `apps/core/src/clients/social-post-providers/index.ts`
- Modify: `apps/core/src/clients/composio.client.ts` (identity tool + parser)
- Test: `apps/core/src/clients/composio.client.test.ts`, `apps/core/src/services/project-social-connections.service.test.ts`

**Interfaces:**
- Consumes: Task 3 context/tools.
- Produces: `publishFacebookPost(context)`; registry entry `facebook: "FACEBOOK_CREATE_POST"`; identity lookup returns the single managed Page (`externalAccountId` = Page id, `externalHandle` = Page name).

Sequence: `page_id` from `externalAccountId`. Images: 1 → `FACEBOOK_CREATE_PHOTO_POST` `{ page_id, url: ref.fileUrl, message: text, published: true }`; 2–4 → `FACEBOOK_CREATE_MULTI_PHOTO_POST` `{ page_id, photo_urls, message: text }`. Video → `FACEBOOK_CREATE_VIDEO_POST` `{ page_id, file_url: ref.fileUrl, description: text, published: true }`. Text-only → `FACEBOOK_CREATE_POST` `{ page_id, message: text, published: true }`. `externalId` from `post_id`/`id`; `publishedUrl` from the response `permalink_url` when present, else `socialPostPublishedUrl`. Identity: replace the `facebook` entry in `SOCIAL_IDENTITY_TOOLS` with `FACEBOOK_LIST_MANAGED_PAGES` (`{ fields: "id,name", limit: 2 }`) and extend `socialIdentity` for `facebook` to require exactly one item from the `data`/`items` array with no next cursor (Review Focus 3).

- [ ] **Step 1: Write failing tests**
  - `facebook.test.ts`: text post args; one-photo `url`; two-photo `photo_urls`; video `file_url`; permalink preferred over the fallback URL; provider refusal maps to `ComposioToolError`.
  - `composio.client.test.ts` identity suite: one Page resolves to its id/name; zero Pages and two Pages both fail with a clear error; existing fixtures updated from `FACEBOOK_GET_CURRENT_USER`.
  - `project-social-connections.service.test.ts`: finalize stores the Page id/name for Facebook.
- [ ] **Step 2: Run:** `pnpm --filter @sokosumi/database prisma:generate && pnpm --filter @sokosumi/core test facebook && pnpm --filter @sokosumi/core test composio && pnpm --filter @sokosumi/core test project-social-connections` — FAIL.
- [ ] **Step 3: Implement adapter + identity change + dispatch case.**
- [ ] **Step 4: Run:** same command — PASS.
- [ ] **Step 5: Commit:** `feat(core): publish social posts to Facebook Pages`.

---

### Task 6: Instagram adapter

**Files:**
- Create: `apps/core/src/clients/social-post-providers/instagram.ts`
- Create: `apps/core/src/clients/social-post-providers/instagram.test.ts`
- Modify: `apps/core/src/clients/social-post-providers/index.ts`

**Interfaces:**
- Consumes: Task 3 context/tools.
- Produces: `publishInstagramPost(context)`; registry entry `instagram: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH"`.

Sequence: `ig_user_id` from `externalAccountId`. Container: `INSTAGRAM_POST_IG_USER_MEDIA` with `{ ig_user_id, caption: text, image_url: ref.fileUrl }` or `video_url` for a video; container id from `data.id`/`data.creation_id`. Publish: `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH` with `{ ig_user_id, creation_id, max_wait_seconds: 180 }`; `externalId` from the returned media id; `publishedUrl` from `socialPostPublishedUrl` (null); `providerOutcome` `"published"`.

- [ ] **Step 1: Write failing tests** in `instagram.test.ts`: image container uses the Drive URL and caption; video uses `video_url`; publish passes the container id and wait; a container-refusal maps to `ComposioToolError` (Review Focus 1); result carries the media id and null URL.
- [ ] **Step 2: Run** filtered Instagram test — FAIL.
- [ ] **Step 3: Implement adapter and dispatch case.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit:** `feat(core): publish social posts to Instagram`.

---

### Task 7: YouTube adapter

**Files:**
- Create: `apps/core/src/clients/social-post-providers/youtube.ts`
- Create: `apps/core/src/clients/social-post-providers/youtube.test.ts`
- Modify: `apps/core/src/clients/social-post-providers/index.ts`

**Interfaces:**
- Consumes: Task 3 context/tools; `downloadSocialPostMedia`.
- Produces: `publishYouTubeVideo(context)`; registry entry `youtube: "YOUTUBE_UPLOAD_VIDEO"`; pure helper `deriveYouTubeTitle(text: string): string` (first non-empty line trimmed, sliced to 100 characters).

Sequence: download the single video's bytes (provider caps), stage via `stageSocialPublishFile` (toolkit `youtube`, tool `YOUTUBE_UPLOAD_VIDEO`), execute with `{ title: deriveYouTubeTitle(text), description: text, tags: [], categoryId: "22", privacyStatus: "public", videoFilePath: { name, mimetype, s3key } }`. `externalId` from the response `id`/`videoId`; `publishedUrl` `https://www.youtube.com/watch?v={externalId}`; `providerOutcome` `"public"`.

- [ ] **Step 1: Write failing tests** in `youtube.test.ts`: title derivation (multi-line, >100 chars, single line); staged `s3key` upload then upload args including `privacyStatus: "public"` and `categoryId: "22"`; result URL; refusal mapping.
- [ ] **Step 2: Run** filtered YouTube test — FAIL.
- [ ] **Step 3: Implement adapter, `deriveYouTubeTitle`, and dispatch case.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit:** `feat(core): publish social posts to YouTube`.

---

### Task 8: TikTok adapter

**Files:**
- Create: `apps/core/src/clients/social-post-providers/tiktok.ts`
- Create: `apps/core/src/clients/social-post-providers/tiktok.test.ts`
- Modify: `apps/core/src/clients/social-post-providers/index.ts`

**Interfaces:**
- Consumes: Task 3 context/tools.
- Produces: `publishTikTokVideo(context)`; registry entry `tiktok: "TIKTOK_PUBLISH_VIDEO"`; pure helper `pickTikTokPrivacyLevel(available: readonly string[]): string` — most permissive of `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR`, `SELF_ONLY` (default `SELF_ONLY` when none match).

Sequence: `TIKTOK_QUERY_CREATOR_INFO` → `privacy_level_options`; pick with the helper; `TIKTOK_PUBLISH_VIDEO` with `{ video_url: ref.fileUrl, caption: text, privacy_level }`; then poll `TIKTOK_FETCH_PUBLISH_STATUS` with backoff (start 5 s, double, cap 30 s) inside the publish budget/signal until `PUBLISH_COMPLETE` (success, `externalId` = returned post id when present else `publish_id`) or `FAILED` (permanent `ComposioToolError`). `providerOutcome` records the chosen level. An abort/timeout after the publish call is initiated throws `ComposioPublishOutcomeUnknownError` (Review Focus 2).

- [ ] **Step 1: Write failing tests** in `tiktok.test.ts`: privacy picker matrix including unaudited (`["SELF_ONLY"]`); publish args carry the caption and chosen level; polling resolves on `PUBLISH_COMPLETE`; `FAILED` maps to a permanent tool error; timeout after initiation rejects with `ComposioPublishOutcomeUnknownError`; `providerOutcome` includes the level.
- [ ] **Step 2: Run** filtered TikTok test — FAIL.
- [ ] **Step 3: Implement adapter, helper, and dispatch case.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit:** `feat(core): publish social posts to TikTok`.

---

### Task 9: Web composer, page, and icons

**Files:**
- Modify: `apps/web/src/app/(app)/projects/[projectId]/social/page.tsx`
- Modify: `apps/web/src/app/(app)/projects/components/social-posts/social-post-composer-dialog.tsx`
- Modify: `apps/web/src/app/(app)/projects/components/social-posts/project-social-posts.tsx`
- Modify: `apps/web/src/app/(app)/calendar/components/social-post-calendar-event.tsx`
- Modify: `apps/web/src/lib/actions/project/action.ts`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json`, `apps/web/messages/es.json`
- Test: `apps/web/src/app/(app)/projects/components/social-posts/social-post-composer-dialog.test.tsx` (create if absent)

**Interfaces:**
- Consumes: regenerated Core client (`provider` union, updated caps) and Task 1 rules.
- Produces: composer derives the provider from the selected connection (`post?.provider ?? selectedConnection?.provider ?? "x"`), enforces text/media/video requirements with hints, and offers the provider's MIME types in the Drive picker; the social page passes every active connection; post rows and calendar events render the provider icon from `social-icons.tsx`.

- [ ] **Step 1: Regenerate the Core client**

Run: `pnpm --filter @sokosumi/core-client generate:snapshot` then `pnpm --filter web typecheck`.
Expected: regenerated `provider` union and no web errors beyond the changes below.

- [ ] **Step 2: Write failing tests** in the composer suite: Instagram requires media and disables save without it; TikTok/YouTube require a video; LinkedIn/YouTube require text; switching the selected connection changes the enforced text limit and hint; the social page passes non-X active connections (page-level data test or assertion in the existing page suite).
- [ ] **Step 3: Run:** `pnpm web:test -- social-post` — FAIL.
- [ ] **Step 4: Implement**
  - `page.tsx`: drop the `provider === "x"` filter.
  - Composer: compute the provider from the selected connection; derive `DRIVE_PICKER_ACCEPT` and validation per render from `SOCIAL_POST_MEDIA_RULES[provider]`; add requirement messages; keep `isScheduleOnly` semantics.
  - `action.ts`: media array max and text max from the shared maxes.
  - Post list and calendar event: provider icon via a small `{ provider: Icon }` lookup using `SOCIAL_ICONS`/`social-icons.tsx`; remove the hardcoded X icon.
  - Add translation keys for requirements in all three locales with English values; run `pnpm --filter web messages:parity`.
- [ ] **Step 5: Run** `pnpm web:test -- social-post` and `pnpm --filter web check` — PASS.
- [ ] **Step 6: Commit:** `feat(web): compose social posts for every connected provider`.

---

### Task 10: Soko Bot contracts, skill, and version

**Files:**
- Modify: `packages/soko-bot/src/tool-contracts.ts`
- Modify: `packages/soko-bot/src/versions/skills.ts`
- Create: `packages/soko-bot/src/versions/v18.ts`
- Modify: `packages/soko-bot/src/versions/index.ts`
- Test: `packages/soko-bot/src/__tests__/social-tools.test.ts`, `packages/soko-bot/src/__tests__/versions.test.ts`

**Interfaces:**
- Consumes: Task 1 rules.
- Produces: bot schemas cap text at the max across providers and media at the max image count; descriptions state per-platform requirements; the `social-posts` skill text drops "X only"; `v18` adopts the rewritten skill and becomes `DEFAULT_SOKO_BOT_VERSION_ID`.

- [ ] **Step 1: Write failing tests** in `social-tools.test.ts` and `versions.test.ts`: the text schema accepts 3000 characters and rejects 3001; the media schema accepts four images; descriptions for `list_project_social_accounts`/`create_social_post`/`schedule_social_post` no longer match `/X only/` and mention media/video requirements; the default version's composed prompt contains the rewritten skill (e.g. `/all providers|LinkedIn/`) and `create_social_post`.
- [ ] **Step 2: Run:** `pnpm --filter @sokosumi/soko-bot test` — FAIL.
- [ ] **Step 3: Implement** the schema caps from the shared maps, rewrite the eight social tool descriptions and the `social-posts` skill content (requirements per provider; human-only connection rule unchanged), add `v18.ts` following `v17.ts`'s pattern (same skills/tools, new id/name/createdAt/summary), append it to `SOKO_BOT_VERSIONS`, and set the default id.
- [ ] **Step 4: Run:** `pnpm --filter @sokosumi/soko-bot test && pnpm --filter @sokosumi/soko-bot build` — PASS.
- [ ] **Step 5: Commit:** `feat(soko-bot): teach social tools every provider`.

---

### Task 11: Documentation and ADR

**Files:**
- Modify: `docs/coworker/social-posts-api.md`
- Modify: `apps/core/README.md`
- Create: `docs/adr/0044-social-publishing-adapters.md`
- Modify: `CONTEXT.md` (only if it claims X-only publishing)

**Interfaces:**
- Consumes: the spec and Tasks 1–10.
- Produces: docs that match shipped behavior.

- [ ] **Step 1:** Replace the X-only statements in `docs/coworker/social-posts-api.md:20` with the provider matrix and the scopes/prerequisites checklist from the spec.
- [ ] **Step 2:** Update `apps/core/README.md:64-106` platform table and remove the "Publishing and scheduling currently support X only" statement.
- [ ] **Step 3:** Add `docs/adr/0044-social-publishing-adapters.md` following the format of `docs/adr/0042-core-owned-project-social-connections.md`: context, decision (provider registry + per-provider adapters behind one publisher; public-URL media where the tool accepts it, staged bytes otherwise; no schema change), consequences (Facebook reconnect, TikTok privacy recorded, follow-ups).
- [ ] **Step 4:** Update `CONTEXT.md` glossary only if it states publishing is X-only.
- [ ] **Step 5: Commit:** `docs(social-posts): document all-provider publishing`.

---

### Task 12: Whole-feature verification and manual E2E

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-social-post-providers-design.md` (record manual results) or the PR description.

- [ ] **Step 1: Full checks**

Run: `pnpm check && pnpm typecheck && pnpm test`
Expected: all green.

- [ ] **Step 2: Owner-run manual checklist** (beta org `utxo`, one connected account per provider with publishing scopes; record results in the PR)
  - X: text + 1 image publish now (regression).
  - LinkedIn: text-only publish; text + 1 image; video.
  - Facebook: text-only; 2 images; video.
  - Instagram: image with caption; video.
  - TikTok: video with caption (confirm the recorded privacy level matches the account's options).
  - YouTube: video with derived title (confirm public URL works).
  - Schedule one non-X post with a short lead and confirm the cron publishes it.
  - Confirm each platform's post appears with the provider icon in the list and calendar.
- [ ] **Step 3: Review pass** — run the diff review on the branch, fix findings, repeat until clean.
- [ ] **Step 4: Commit any fixes**, then summarize results in the PR/description.
