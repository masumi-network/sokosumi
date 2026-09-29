# Social scheduling: tools and platform posting flows

Research for the Sokosumi Social page (calendar, posts list, connected accounts, composer), from Linear SOK-1241. Checked 2026-09-29.
Items marked **(unverified)** were not confirmed against a primary source in this pass.

## TL;DR

- Every leading tool puts **one composer** at the center: pick accounts (chips/avatars) → write once → optionally "customize per network" → live per-network preview → schedule (queue slot, best time, or custom date/time).
- Speed comes from **defaults**, not from fewer features: last-used account preselected, "next free slot" one click away, keyboard submit, media drag-drop.
- **No platform accepts rich text through its posting API** for normal posts. Tools either offer Unicode "bold/italic" (Typefully) or say plainly they do not format (Metricool). X Articles is the exception: X now documents Articles endpoints (rich text, DraftJS), eligibility unverified.
- Time zones: tools store a **per-account (channel) time zone** and display the calendar in the viewer's/browser zone, with an explicit zone label. Buffer and Typefully both let the viewing zone differ from the posting zone.
- Recommended Sokosumi order: fix navigation (month + tabs + connect up front), then platform picker + per-platform limits/format, then date/time + time zone, then a measured "X in <30s" happy path.

## What the SOK-1229…SOK-1240 stack ships

| Issue | Shipped | Differs from §4 |
|---|---|---|
| SOK-1229 | Social's calendar opens on Month; a picked view wins | No per-user persistence beyond `?view=` |
| SOK-1230 | Tabs: Calendar · Drafts · Needs attention (while non-empty) · Accounts, in `?tab=`; Upcoming list and Agenda view removed | Drafts stay a tab, not a status filter |
| SOK-1231 | Empty-project prompt naming the networks, links to Accounts; Accounts tab counts connections | — |
| SOK-1233 | "Manual post", as the design feedback asked | §4 suggests avoiding "manual" |
| SOK-1234 | Account chips at the top of the composer; several accounts make one post each | No last-used memory yet |
| SOK-1235 | Per-platform format and count/limit under the text | No format selector, X Articles or threads |
| SOK-1236 | Toolbar: Unicode bold/italic/underline, link as bare URL, ⌘B/I/U | §4 recommends plain text in v1 |
| SOK-1237 | Quick picks (in an hour, tomorrow, Monday), date popover, 15-min time list | No "next slot" (no queue yet) |
| SOK-1238 | Composer names the viewer's zone and the post's own zone when different; rows and calendar name the zone | No per-account zone setting |
| SOK-1239 | Post now (create + publish), text focused on open, ⌘Enter | Not instrumented yet |
| SOK-1240 | Task board status marker scale and card styling | — |

## 1. Scheduling tools

| Tool | Navigation | Composer | Scheduling UX | Formatting | Speed-to-publish |
|---|---|---|---|---|---|
| **Buffer** | Calendar with Week and Month views; filter by channel and by status (Drafts, Scheduled, Sent, Pending approval); drag-drop reschedule | Select channels; "Customize for each network" splits into one box per network | Per-channel weekly **time slots**; "Add to Queue" (default) fills next free slot; "Schedule post" for custom time | Plain text (unverified: no Unicode toolbar) | Default action needs no date pick: write → Add to Queue |
| **Hootsuite** | Planner calendar (day/week/month, unverified exact set); drafts in planner | Account picker with search by handle/network/team and **favorites** pinned to top; content copied per network, edit via network tabs; **real-time preview per account**; editable link preview | "Schedule for later" → "see recommended times" (best time from own analytics); AutoSchedule per network; bulk CSV scheduling | Plain text (unverified) | Favorites + recommended times reduce picking |
| **Typefully** | Calendar views **Flex / Month / Week** (keys V/M/W, T = today, arrows navigate); Queue tab on mobile; filters by status, platform, tags; drafts first-class | Writer-first editor; threads as split posts; multi-platform (X, LinkedIn, Threads, Bluesky, Mastodon) | Three options in editor: **Next slot**, **Browse queue**, **Best time**; saved slots; "Natural posting times" ±4 min jitter; "planned" (calendar only) vs "scheduled" | **Unicode** bold / italic / underline / strikethrough (plus decorative styles) | **⌘⌥Enter = schedule to next slot**; keyboard-driven end to end |
| **Later** | Calendar-centric; **media library sidebar** dragged onto calendar | Media-first (visual planning, esp. Instagram) | **Quick Schedule**: recurring weekly slots, drop media onto slot; Best Time to Post from own data | Plain text (unverified) | Drag media → slot; bulk-drop onto calendar top |
| **Metricool** | Planning calendar with time-zone setting, filters, display options; **best times shaded** in the calendar (needs ≥100 followers) | Multipost with per-network edit tabs | Click a shaded slot to schedule there; recurring posts | **Explicitly no rich text** (no bold/italic/underline/bullets) | Best-time shading doubles as quick pick |
| Publer (optional) | Calendar + list (unverified) | Per-network formats, e.g. X long-form posts documented | Queue + custom (unverified) | Unverified | — |

Patterns worth copying:
1. **Composer is a modal/drawer reachable from everywhere** (calendar cell click prefills date/time).
2. **Account selection = avatar chips with network badge**, favorites/last-used preselected.
3. **"Write once, then diverge"**: shared body, per-network tabs only when the user opts in; per-network validation badges (char count, media errors).
4. **Schedule menu with 3 choices**: next slot / best time / pick date+time. Custom date+time is the fallback, not the default.
5. **Drafts, scheduled, sent, needs-approval as statuses/filters**, not separate pages.

## 2. Platform posting capabilities (public API vs native app)

| Platform | Via API | Native-only / not via API | Text limit | Media limits (API) | Rich text | Links |
|---|---|---|---|---|---|---|
| **X** | Posts, replies (threads = reply chains, each post created with `reply.in_reply_to_tweet_id`), quotes, polls (unverified), media posts; long posts up to 25,000 chars for Premium users | Articles historically native-only; **X now documents Articles endpoints** (create draft + publish, DraftJS rich text) — tier/eligibility **unverified**; Communities/Spaces partly | 280 (free), 25,000 (Premium) | Up to **4 photos, or 1 GIF, or 1 video** per post; image 5 MB, GIF 15 MB; video duration/size depend on user's Premium status | None in posts (Unicode workaround); Articles support rich text | URLs count as fixed length (t.co, unverified 23 chars); card preview auto |
| **LinkedIn** | Posts API: text, image, multi-image, video, document, article (link card), poll, celebration (organic) | Native long-form Articles/Newsletters editor (unverified as API-unavailable); carousels only for sponsored | 3,000 chars | Multi-image, single video, document (PDF) | None. `commentary` uses **little text format**: plain text + mentions `@[Name](urn)` + hashtags; reserved chars (`* _ ~ # @ [ ] ( ) { } < > \|`) **must be backslash-escaped** | Article/link post with URL card |
| **YouTube** | `videos.insert` upload; schedule by uploading `privacyStatus=private` + `publishAt` (only if never published) | Community posts, Shorts-specific editing (unverified) | Title 100 chars, description 5,000 bytes | One video per call; upload costs large quota share (default 10,000 units/day, unverified exact cost) | None (plain description) | Links in description |
| **Instagram** | Single image, video, **Reels**, **Stories**, **Carousels** (≤10 items, cropped to first item, default 1:1) | Shopping tags, filters, music (unverified) | Caption 2,200 (secondary source) | **JPEG only**; publishing cap 100 API posts / rolling 24h per account (carousel = 1); check `content_publishing_limit` | None | **Links in captions not clickable** (unverified, well known) |
| **Facebook Page** | Feed text, link, photo, video, reels; native `scheduled_publish_time` | Some formats (e.g. certain event/story types, unverified) | ~63,206 chars (unverified) | Reels cap 30 / Page / 24h (secondary source) | None | Link preview card |
| **TikTok** | Content Posting API: video + photo; `DIRECT_POST` or `MEDIA_UPLOAD` (goes to user's TikTok inbox as draft) | Sounds/effects editing | Title/caption 2,200 (video), **90 for photo title** | **Unaudited apps: all posts forced private** — needs app audit before public posting | None | Not clickable (unverified) |

Implications for Sokosumi:
- **Per-platform formats (SOK-1235)** should be driven by a capability map like the table above, not by free-form UI. X: Post / Thread (later) / Article (only if Articles API eligibility confirmed). LinkedIn: Post (text/image/multi-image/video/document), Poll later. Instagram: Feed post / Carousel / Reel / Story. YouTube: Video. Facebook: Post / Reel. TikTok: Video / Photo (+ "send to drafts" mode).
- **Formatting (SOK-1236)**: real bold/italic cannot be posted to any network via API. Options: (a) Unicode math-alphanumeric substitution (what Typefully does), (b) plain text only (Metricool). Unicode styling hurts screen readers and search; underline is combining characters and renders inconsistently. Links: render as plain URL text (all networks auto-link or card-ify). LinkedIn needs escaping of reserved chars regardless.
- Validation must be per network: char count, media count/type (e.g. JPEG-only for IG, 4 images on X), and TikTok audit state.

## 3. Ease-of-use principles for fast posting

1. **Zero required decisions beyond text.** Preselect last-used account(s); default schedule = "Post now" or "Next slot"; media optional.
2. **One entry point, everywhere.** Primary "New post" button + keyboard shortcut; clicking a calendar cell opens the composer prefilled with that date/time.
3. **Inline, per-network validation** (counter turns red at limit, media errors on the chip), never a failing submit.
4. **Progressive disclosure.** Per-network customization, formats, and advanced options behind a toggle/tab; the base composer stays one textarea.
5. **Keyboard submit** (⌘Enter post/schedule, ⌘⇧Enter/⌥ variant for queue) as Typefully does.
6. **Explicit time zone next to every time**, with the account's zone if it differs from the viewer's.
7. **Optimistic feedback**: after submit, close composer, toast with "View / Undo", post appears in calendar immediately.
8. **Recoverability**: autosave drafts; failed posts land in "Needs attention" with the platform error in plain words.

## 4. Recommendations mapped to Linear issues

| Issue | Recommendation |
|---|---|
| **SOK-1229** Month default | Default calendar to Month; keep Week as secondary. Persist last chosen view per user (localStorage is fine). Add "Today" button; consider keyboard M/W/T like Typefully. Clicking a day opens composer prefilled with that date. |
| **SOK-1230** Tabs / drafts | Tabs: **Calendar · Posts · Accounts** (or Calendar · Drafts · Needs attention · Accounts). Model drafts/scheduled/published/failed as **status filters** on one list (Buffer pattern) rather than stacked sections. Show counts on tabs, especially "Needs attention". |
| **SOK-1231** Connect accounts | Empty state = connect CTA row with network buttons (X, LinkedIn, YouTube, Instagram, Facebook Page, TikTok "coming soon" disabled). When accounts exist, show connected avatars in page header with a "+ Connect" affordance; composer's account picker also offers "+ Connect". |
| **SOK-1233** Manual post rename | Use a verb-first label users recognize: "New post" / "Create post" (all tools use "Create/New post" or "Compose"). Avoid "manual" (implies an automated counterpart the user may not know). |
| **SOK-1234** Platform picker | Avatar chips per connected account with network badge, multi-select, last-used preselected, favorites optional (Hootsuite). Disabled chips for unsupported format combinations with tooltip reason. |
| **SOK-1235** Per-platform formats | Format selector appears after account selection, options from a per-network capability map (§2). Start: X Post, LinkedIn Post, IG Feed/Carousel/Reel, FB Post, YouTube Video. Hide X Article until Articles API eligibility is confirmed; mark threads as future. |
| **SOK-1236** Formatting | Recommend **no fake rich text in v1**: plain textarea + link auto-detection + emoji. If design insists, offer Unicode bold/italic only (no underline), with a warning about accessibility and a per-network preview. Escape LinkedIn reserved chars server-side regardless. |
| **SOK-1237** Date/time pickers | Replace free text with design-system date picker + time select (15-min steps, typing allowed). Quick picks: "Now", "Next slot" (later), "Tomorrow 9:00". Validate platform windows (e.g. FB scheduled time 10 min–30 days ahead if we ever use native scheduling). |
| **SOK-1238** Time zone | Show zone abbreviation + offset next to every time ("14:00 CEST"). Store UTC; display in viewer zone with an optional per-project/account zone setting. If viewer and posting zone differ, show both in the composer. |
| **SOK-1239** X in <30s | Define the happy path and measure it: open composer (1 click/shortcut) → X account preselected → type → ⌘Enter "Post now". Target ≤3 clicks + typing. Add a timed usability check / e2e script; instrument `composer_opened → post_submitted` duration. |
| **SOK-1240** Design system | Build from existing design-system primitives (tabs, dialog/sheet, date picker, select, avatar, badge, toast). No bespoke calendar chrome beyond the grid; match spacing/typography tokens used in Projects. |

## 5. Future work

- **Threads** (X reply chains, LinkedIn/Threads not applicable): split editor with per-post counters; publish sequentially with rollback/"needs attention" on partial failure.
- **Per-network variants**: "Customize for each network" toggle with per-network body/media overrides (Buffer/Hootsuite pattern).
- **Queue slots**: per-account weekly slots + "Add to queue" as default schedule action (Buffer, Typefully, Later).
- **Best-time suggestions**: shade calendar slots from own engagement history (Metricool, Hootsuite); needs analytics ingestion first.
- **Live per-network previews** (Hootsuite), link-preview editing.
- **TikTok**: pass TikTok app audit before GA; otherwise posts are private-only.
- **Bulk scheduling / CSV import**, recurring posts.

## Sources

- https://support.buffer.com/article/514-setting-up-your-timezones-and-posting-schedules
- https://support.buffer.com/article/642-scheduling-posts
- https://support.buffer.com/article/651-how-to-use-the-new-calendar-feature-on-buffer
- https://help.hootsuite.com/s/article/create-publish?language=en_US
- https://help.hootsuite.com/s/article/preview?language=en_US
- https://help.hootsuite.com/hc/en-us/articles/204598180-Select-social-accounts-in-the-composer-Legacy-
- https://help.hootsuite.com/s/article/recommended-times?language=en_US
- https://support.typefully.com/en/articles/9210135-scheduling-and-calendar
- https://support.typefully.com/en/articles/8717699-twitter-x-posting-limitations
- https://help.typefully.com/shortcuts
- https://typefully.com/tools/linkedin-text-formatter
- https://help.later.com/hc/en-us/articles/360043243793-How-to-Quick-Schedule-Your-Week-of-Posts
- https://later.com/social-media-glossary/drag-drop/
- https://help.metricool.com/multiposting-edit-per-social-network-85out
- https://help.metricool.com/how-to-manage-your-calendar-in-metricool-xhlbw
- https://help.metricool.com/en/category/planning-2jsbcr/
- https://publer.com/docs/posting/create-posts/content-types/platform-specific-formats/twitter-x-long-form-posts
- https://docs.x.com/x-api/articles/introduction
- https://docs.x.com/x-api/media/quickstart/best-practices
- https://www.socialmediatoday.com/news/x-now-enable-long-post-creation-via-third-party-apps/724178/
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
- https://developers.google.com/youtube/v3/docs/videos
- https://developers.facebook.com/docs/instagram-platform/content-publishing/
- https://developers.facebook.com/docs/graph-api/reference/page/videos/
- https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- https://developers.tiktok.com/doc/content-posting-api-reference-photo-post
