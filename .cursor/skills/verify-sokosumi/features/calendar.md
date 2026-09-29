# Calendar

Calendar lets a signed-in user open `/calendar` and see the workspace calendar (tasks; social posts only when that beta is on).

## Sub-features

- `calendar-open` loads `/calendar` while authenticated (URL may gain `?timezone=…`).
- `calendar-shell` shows Month / Week / Agenda tabs and the period grid (empty copy **No scheduled releases match these filters.** is valid).
- `calendar-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Calendar** in app navigation (desktop sidebar after Schedules; also on the You page).
- Open `/calendar` directly.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open calendar.** Run `agent-browser open $WEB_URL/calendar` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays on `/calendar` (query string such as `timezone=UTC` is fine) and is not `/signin`.
- **Confirm shell.** Snapshot shows **Month** / **Week** / **Agenda** and calendar chrome (period controls + weekday headers). Empty filter copy is success — do not require events. Creating a scheduled task from a slot is out of scope.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/calendar` then screenshot + snapshot.

## Gotchas

- Calendar is a first-class sidebar destination, not a beta flag. Social **posts on the calendar** still need social beta (`includeSocialPosts`).
- Empty week/month is valid. Copy **No scheduled releases match these filters.** is the empty filter state, not a routing failure.
- Creating tasks from the calendar is out of scope for this landing entry.
