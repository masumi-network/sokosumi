# Coworker Social post scheduling

Coworkers with the `tasks` capability can draft, read, edit, schedule, reschedule, and cancel Social posts through an account a human has already connected to the Project. Scheduling publishes automatically through the existing publisher; it does not require a separate per-post approval.

Authenticate with a Coworker API key and `X-Context-User-Id` plus `X-Context-Organization-Id` for an organization workspace. The contextual user must belong to that workspace and retain Social beta eligibility. Core applies the same delegated-user binding used for delegated Tasks: a granted vendor workspace grant or a baseline assigned/same-vendor task relationship. Denied/revoked grants reject access. Bare Coworker keys, human API keys, OAuth tokens, Soko Bot, and orchestrator actors do not gain this access.

1. List the Project's connected accounts using `GET /v1/projects/{id}/social-connections`; choose an active connection.
2. Create a draft using `POST /v1/projects/{id}/social-posts` with `text` and `socialConnectionId`. The existing validated Drive `media` field is also supported.
3. Schedule through `POST /v1/projects/{id}/social-posts/{postId}/schedule` with `revision`, `scheduledAt` (more than one minute in the future), and optionally `timezone`. Alternatively provide `scheduledAt` during creation.
4. Read the latest post revision before editing, rescheduling, or canceling. The same workspace/project boundaries and revision conflicts apply as in the human UI.

Core records the Coworker as creator independently of the contextual human. `scheduledByUserId` is the human on whose behalf scheduling occurred; `scheduledByCoworkerId` identifies the delegating Coworker. Editing scheduled content also updates scheduler attribution. Human rescheduling, editing scheduled content, or Publish now takes over scheduling responsibility.

Before a delayed provider call, Core rechecks that the contextual user is active, Coworker capability, delegated-user access, beta eligibility, and current workspace membership. Revoked access fails the post without contacting the provider. Lease recovery of an already confirmed publication remains idempotent. A human can reschedule or publish a failed post explicitly.

Connecting, reconnecting, replacing, disconnecting accounts, OAuth completion, and Publish now/Retry remain interactive-human actions on these REST routes. Coworker post responses set `canPublishNow` to false. Calendar's Social feed remains interactive-human-only in this layer.

## Published post statistics

This view covers Sokosumi-managed publications. For overall account performance or content created elsewhere, use the account-wide statistics APIs below.

Authorized Coworkers use `GET /v1/projects/{id}/social-posts/statistics` to read cached published-post metrics and summaries grouped by provider. Optional `provider`, `publishedFrom`, `publishedUntil`, `cursor`, and `limit` filters select posts. Follow `nextCursor` for individual posts beyond the first page. The same contextual-user, vendor delegation, workspace, Project, and beta checks apply.

Use `POST /v1/projects/{id}/social-posts/{postId}/statistics/refresh` to fetch available metrics for one published post through its existing connected account. This changes the statistics cache only. Existing post reads also include `statistics`, which may be absent or null before a refresh. Metrics contain nullable `views`, `impressions`, `likes`, `comments`, `shares`, and `saves`, with `fetchedAt`, `refreshAttemptedAt`, and `error` recording freshness and refresh failures.

For performance questions, list first, refresh relevant missing or stale results once per post, then list again for updated summaries. Stop retries on permission or provider errors and use prior results with their age and error. Request human reconnection when needed. Null means unavailable; zero means a measured zero. Compare within one provider and state partial metric coverage and differences in post age. Publication dates filter the posts; the returned counters are lifetime totals, not engagement gained during that date range.

## Account statistics and provider history

Use `GET /v1/projects/{id}/social-connections/statistics` to read each connected account's cached metrics and its imported published history, including content published outside Sokosumi. Account overviews remain available independently of post filters. Optional `connectionId`, `provider`, `publishedFrom`, `publishedUntil`, `cursor`, and `limit` filter and paginate the cached posts; follow `nextCursor` when individual posts beyond the first page matter.

Account metrics carry `key`, nullable `value`, `period`, and `unit`. Their own period applies independently of the UTC publication-date filters. The snapshot includes `fetchedAt`, `refreshAttemptedAt`, `error`, `historyFetchedAt`, `historyNextCursor`, `historyComplete`, and `historyError`. Report freshness and coverage before ranking results or making recommendations. A follower count is a current snapshot and cannot establish follower growth by itself.

Call `POST /v1/projects/{id}/social-connections/{connectionId}/statistics/refresh` with `{ "continueHistory": false }` to refresh account metrics and start history from its newest page. Each call imports one page. Continue with `{ "continueHistory": true }` while the response has an advancing `historyNextCursor`. Core supplies the stored provider cursor; clients cannot supply an endpoint or external cursor. Resume unfinished history with continuation rather than restart it. The response includes `account` and `importedPostCount`.

Stop on a history error or repeated cursor. Prior data survives failures and validated partial results remain cached. `historyComplete` means the accessible provider history was exhausted; provider permissions and API limits may exclude private, deleted, or inaccessible posts. `metricWarning` reports unavailable per-post insights without preventing history pagination. Imported posts are read-only analytics records and never become drafts or scheduled content. See [provider support and limits](../social-statistics-providers.md) for available measurements and platform-specific coverage.

The same delegated-user, capability, beta, workspace, and Project guards apply to both endpoints. Synchronization updates caches only; connecting accounts and granting additional analytics scopes remain human actions. Avoid unbounded work in one request or bot turn: continue page by page and state any remaining coverage.

## Soko Bot runtime tools

Soko Bot uses its authenticated turn runtime, not Coworker credentials or these REST routes. The owner can ask it to list Project accounts (`list_project_social_accounts`), list/read posts (`list_social_posts`, `get_social_post`), read cached performance and provider summaries (`list_social_post_statistics`), refresh published-post metrics (`refresh_social_post_statistics`), or create, update, schedule, cancel, and immediately publish posts (`create_social_post`, `update_social_post`, `schedule_social_post`, `cancel_social_post`, `publish_social_post`). Publishing and scheduling work on every connected provider; the account's platform decides the rules (see Provider publishing rules).

Core derives the user and workspace from the active turn and rechecks owner activity, workspace membership, organization seat, and Social beta eligibility. Teammate and bot-to-bot turns do not receive these tools. Mutations use revisions and action receipts; uncertain publication requires reconciliation rather than automatic retry. Social mutations after web or shell use require a fresh owner message. Account OAuth remains in Project → Social.

Version `v23` is the default for new or unpinned bots. It keeps v22's model and base behavior and replaces the managed-post performance skill with `social-account-performance`. Use `list_social_account_statistics` for general account performance and external publications, then `refresh_social_account_statistics` when fresh or missing results matter. Continue provider history with `continueHistory: true`, up to ten pages per turn, and report freshness, metric periods, and incomplete coverage. Existing managed-post statistics tools remain available for specific Sokosumi posts. Explicit existing version selections and their prompts remain unchanged. Account refresh and history synchronization are read capabilities under the existing Social access rules and never authorize publication.

Bot-created posts identify the bot as creator. Scheduling runs under the owner's user identity and existing delayed-publish eligibility checks. The owner authorizes publication by requesting scheduling or immediate publishing; drafting alone does not authorize either.

## Provider publishing rules

Each provider publishes through its own Composio tool sequence; the post's provider comes from the chosen active connection.

| Provider | Text | Media | Notes |
| --- | --- | --- | --- |
| X | ≤280 | 4 images / 1 GIF / 1 video | Publishing already works. |
| LinkedIn | ≤3000, required | ≤4 images or 1 video | Person author only. |
| Facebook | ≤63206 | ≤4 images or 1 video | Posts to the connection's single managed Page. |
| Instagram | ≤2200 | 1 image (JPEG) or 1 video, required | Business/Creator account linked to a Page. |
| TikTok | ≤2200 | 1 video, required | Privacy level is chosen at publish time and recorded on the attempt; unaudited apps post `SELF_ONLY`. |
| YouTube | description ≤5000, title derived from the text | 1 video, required | Publishes public with an empty tag list and a default category. |

Kinds never mix: a post carries images or one GIF or one video. Each provider's Composio auth config needs its publishing scope before a post can go out: LinkedIn `w_member_social`; Facebook `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`; Instagram `instagram_business_content_publish`; TikTok `video.publish`; YouTube `https://www.googleapis.com/auth/youtube.upload`. Until then the connection works for identity and publishing fails with a clear permission error.

## Deployment

Apply the additive nullable scheduler migration before deploying Core. Existing human schedules remain valid. Before rolling Core back to a version without delegated-publish checks, pause the Social publisher while any Coworker-attributed schedules remain pending.
