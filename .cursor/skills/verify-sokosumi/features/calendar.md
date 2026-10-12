# Calendar

Calendar lets a signed-in user open the workspace calendar (Month / Week / Agenda) as the **Calendar** tab on `/tasks`. `/calendar` redirects there. Tasks show on the grid; social posts only when that beta is on.

## Sub-features

- `calendar-open` loads the Calendar tab while authenticated (`/tasks?tab=calendar`; `/calendar` redirects here). The URL may gain `?timezone=…`.
- `calendar-shell` shows Month / Week / Agenda tabs and the period grid (empty copy **No scheduled releases match these filters.** is valid).
- `calendar-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Tasks** in app navigation, then the **Calendar** tab.
- Open `/tasks?tab=calendar` directly.
- Open `/calendar` (redirects to `/tasks?tab=calendar`, preserving timezone and other calendar query params).
- Not a desktop sidebar row and not listed on the You page.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open calendar.** Run `agent-browser open $WEB_URL/calendar` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL becomes `/tasks?tab=calendar` (query string such as `timezone=UTC` is fine) and is not `/signin`. Opening `$WEB_URL/tasks?tab=calendar` directly is the same surface.
- **Confirm shell.** Snapshot shows **Month** / **Week** / **Agenda** (`calendar-views`) and calendar chrome (period controls + weekday headers). Empty filter copy is success — do not require events. Creating a scheduled task from a slot is out of scope.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/calendar` then screenshot + snapshot.

## Gotchas

- Calendar is a Tasks tab (`TASKS_TAB_VALUES` includes `calendar`), not a first-class sidebar destination. `/calendar` still exists as a redirect into that tab.
- Social **posts on the calendar** still need social beta (`includeSocialPosts`).
- Empty week/month is valid. Copy **No scheduled releases match these filters.** is the empty filter state, not a routing failure.
- Creating tasks from the calendar is out of scope for this landing entry.
