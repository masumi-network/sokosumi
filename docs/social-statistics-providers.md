# Social account statistics and provider history

Verified against primary tool schemas and platform sources on 2026-10-08.
Live connected-account calls still require the account's analytics/read scopes.
Unavailable measurements remain null, measured zero remains zero, and errors
never replace prior cached results. Numeric analytics carry their own period
and unit; account totals do not inherit the post publication-date filter.

## Supported reads

| Provider | Account metrics | Published history | Limits |
| --- | --- | --- | --- |
| X | Followers, following, posts, media, lists, and posts liked where returned | Account's own timeline; engagement and additional public counters | Native timeline exposes up to 3,200 recent posts; inaccessible/deleted content is excluded |
| Instagram | Followers, following, media count, and available 28-day insights | Own Business/Creator media with base engagement, media insights, and available Reels metrics | Insights depend on scopes, account thresholds, and media type |
| Facebook | Page followers/likes and available daily insight totals | Own Page's published posts with engagement and available post insights | Daily sums are not distinct 28-day audience totals |
| YouTube | Channel subscribers, public video count, lifetime views, and available Analytics | Uploaded-video playlist with published dates and batch video counters | Subscriber totals may be hidden or rounded; Analytics requires a separate read scope |
| TikTok | Followers, following, total received likes, and video count | Accessible public videos and their returned counters | Display API and `video.list` permissions govern history availability |
| LinkedIn | Explicitly unavailable for existing personal connections | Explicitly unavailable | Organization analytics require organization identity and scopes; personal publishing permission does not grant personal history reads |

The catalogs define the accepted profile, analytics, and history tool arguments:
[X](https://docs.composio.dev/toolkits/twitter),
[Instagram](https://docs.composio.dev/toolkits/instagram),
[Facebook](https://docs.composio.dev/toolkits/facebook),
[YouTube](https://docs.composio.dev/toolkits/youtube),
[TikTok](https://docs.composio.dev/toolkits/tiktok), and
[LinkedIn](https://docs.composio.dev/toolkits/linkedin).

YouTube history uses upload playlist items, not search results. Counters and
dates come from video details or `contentDetails.videoPublishedAt`, never playlist insertion dates. A failed detail batch preserves listed videos and pagination; an unknown publication date remains null. Its
deprecated `favoriteCount` is not a saves measurement. Channel `videoCount`
counts public videos, and hidden subscriber counts stay unavailable.
Sources: [playlist items](https://developers.google.com/youtube/v3/docs/playlistItems/list),
[videos](https://developers.google.com/youtube/v3/docs/videos),
[channels](https://developers.google.com/youtube/v3/docs/channels), and
[Analytics reports](https://developers.google.com/youtube/analytics/reference/reports/query).

TikTok history uses the authenticated user's video list and batch query, with
integer cursors and explicit `has_more`. No native account lifetime-view or
saves counter is assumed. Sources: [user info](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info),
[video list](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list), and
[video object](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object).

LinkedIn organization statistics cannot substitute for a personal connection.
An authored-post finder requires approved reading access, which the current
personal publishing connection does not establish. Sources:
[organization statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/page-statistics?view=li-lms-2026-09) and
[Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-05).

## Pagination and native reads

Core uses a private account-pinned GET proxy for the account's X timeline and
Facebook Page posts because the connector catalog omits suitable authored
timeline or cursor inputs. This is not a generic bot or client proxy. IDs are
stored numeric account IDs; endpoints, hosts, methods, projections, and query
parameter names are fixed in Core. Only validated opaque tokens are advanced. X uses `api.x.com` and retries the fixed `api.twitter.com` alias only when Composio rejects the toolkit domain; ordinary provider failures are not retried across hosts.
Provider `paging.next` URLs are never followed or stored. Restricted tool-router
sessions keep proxy execution disabled.
[Composio proxy schema](https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteProxy).

The current native X schema uses `post.fields`, `note_post`, and `repost_count`;
the separately versioned Composio post-lookup schema retains its catalog inputs.
The timeline query is scoped by the stored own-account ID and rejects an
explicit mismatched author. Retweets are not excluded. `like_count` on a user
describes posts that user liked, not likes received on their content.
Sources: [official X OpenAPI](https://api.x.com/2/openapi.json) and
[timeline limits](https://docs.x.com/x-api/posts/timelines/introduction).

The Facebook native read pins Graph v26.0, matching Meta's current official
SDK. Advance `paging.cursors.after` only when `paging.next` exists; a remaining
cursor alone does not prove another page exists. Sources:
[Meta API version](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py),
[Page fields](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py), and
[cursor implementation](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/api.py).

Each refresh handles one bounded page: X 100, Facebook/Instagram 10, YouTube 50,
and TikTok 20. Meta enrichment uses at most three concurrent insight calls.
Account metrics and history fail independently. Missing post insights produce
`metricWarning` and null counters while successful history keeps advancing.
An enumeration error retains progress and makes incomplete coverage visible.
`historyComplete` means accessible provider history was exhausted, not proof
that every historical, private, or deleted post was retrieved.

Imported posts live in the read-only account history cache, separate from
schedulable Social posts. A canceled sync finishes any current request and
starts no further pages; the stored cursor permits continuation.
