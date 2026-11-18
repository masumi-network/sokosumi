# Social posts

Social posts lets a signed-in user open `/social` and see scheduled posts across projects, including an empty calendar. The desktop sidebar always includes this row, labeled **Social posts**.

## Sub-features

- `social-open` loads `/social` while authenticated. The URL may gain `?timezone=…`.
- `social-tabs` shows **Calendar**, **Drafts**, **Needs attention**, **Performance**, and **Accounts**, plus **New post**.
- `social-calendar-or-empty` shows the month (or week) grid. Empty copy **No social posts are scheduled in this period.** is valid.
- `social-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Social posts** in the desktop sidebar **Marketing** group (after **Content Studio**). **Files** is in **Records**, above Marketing, not under this row.
- Open `/social` directly.
- **Ads** is a separate sidebar row, open to everyone. It is not this page.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open social.** Run `agent-browser open $WEB_URL/social` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays on `/social` (a `timezone` query is fine) and is not `/signin`.
- **Confirm shell.** Snapshot shows **Calendar** / **Drafts** / **Needs attention** / **Performance** / **Accounts** and **New post**. The calendar tab shows a month or week grid, or empty copy **No social posts are scheduled in this period.** Do not require posts. Do not require **Ads**.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/social` then screenshot + snapshot.

## Gotchas

- Social posts is public. **Ads** (`/ads`) is open to everyone too. The sidebar label is **Social posts**, not “Social Scheduling”.
- With no project selected, Calendar, Needs attention, and Performance span projects. **Drafts** keeps the heading **Drafts** and asks you to choose a project (**Create project**). **Accounts** asks to **Choose a project**. Needs attention does not; an empty workspace has nothing that needs attention. Those states are the all-projects page, not missing tabs.
- Creating or publishing a post is out of scope. The workspace [Calendar](./calendar.md) (`/calendar`) is a different grid: Social embeds the same component locked to Social posts.
