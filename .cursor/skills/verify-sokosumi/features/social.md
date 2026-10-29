# Social Scheduling

Social Scheduling lets a signed-in user open `/social` and see scheduled posts across projects, including an empty calendar. The desktop sidebar always includes this row.

## Sub-features

- `social-open` loads `/social` while authenticated. The URL may gain `?timezone=…`.
- `social-tabs` shows **Calendar**, **Drafts**, **Needs attention**, **Performance**, and **Accounts**, plus **New post**.
- `social-calendar-or-empty` shows the month (or week) grid. Empty copy **No social posts are scheduled in this period.** is valid.
- `social-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Social Scheduling** in app navigation (desktop sidebar after **Content Studio**, before **Files**).
- Open `/social` directly.
- **Ads** is a separate sidebar row and appears only when social beta is on. It is not this page.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open social.** Run `agent-browser open $WEB_URL/social` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays on `/social` (a `timezone` query is fine) and is not `/signin`.
- **Confirm shell.** Snapshot shows **Calendar** / **Drafts** / **Needs attention** / **Performance** / **Accounts** and **New post**. The calendar tab shows a month or week grid, or empty copy **No social posts are scheduled in this period.** Do not require posts. Do not require **Ads**.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/social` then screenshot + snapshot.

## Gotchas

- Social Scheduling is public. Social beta gates **Ads** (`/ads`) only.
- With no project selected, Calendar and Performance span projects. **Drafts**, **Needs attention**, and **Accounts** ask to **Choose a project**. That prompt is the all-projects state, not a missing tab.
- Creating or publishing a post is out of scope. The workspace [Calendar](./calendar.md) tab is a different grid (`/tasks?tab=calendar`).
