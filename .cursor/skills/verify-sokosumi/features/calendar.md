# Calendar

Calendar is a destination of its own (`/calendar`, a **Calendar** row in the sidebar's Work group after **Schedules**). It shows everything with a date in Month / Week / Agenda: Tasks (Runs and Run at), Social posts, Newsletter issues, Contact follow-ups and the Marketing plan. Each feature is a filter, chosen with **Show**.

## Sub-features

- `calendar-open` loads `/calendar` while authenticated. The URL may gain `?timezone=…`.
- `calendar-shell` shows Month / Week / Agenda tabs, the **Show** filter and the period grid (empty copy **No scheduled releases match these filters.** is valid).
- `calendar-show` is the **Show** menu: one checkbox per feature (**Newsletter** only where the workspace has it). It writes `types=…` to the URL (absent means every feature).
- `calendar-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Calendar** in the sidebar (Work group, after **Schedules**). It follows the header's Project scope (`?projectId=`); **All projects** shows the workspace.
- Open `/calendar` directly.
- Old links still work: `/tasks?tab=calendar` and `socialOnly=true` open `/calendar` (the latter as `types=social`), and `/newsletter/calendar` opens `/calendar?types=newsletter` for the Project in scope.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open calendar.** Run `agent-browser open $WEB_URL/calendar` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays on `/calendar` (query string such as `timezone=UTC` is fine) and is not `/signin`. Opening `$WEB_URL/tasks?tab=calendar` redirects to the same page.
- **Confirm shell.** Snapshot shows **Month** / **Week** / **Agenda** (`calendar-views`), a **Show** button and calendar chrome (period controls + weekday headers). Empty filter copy is success — do not require events. Creating a scheduled task from a slot is out of scope.
- **Try Show.** Click **Show**, uncheck features until only **Social posts** is left: the URL gains `types=social`, **Agenda** disappears and the status summary appears. The last feature cannot be unchecked.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/calendar` then screenshot + snapshot.

## Gotchas

- Calendar is not a Tasks tab any more; `TASKS_TAB_VALUES` is gone. Social embeds the same component locked to Social posts (`types={["social"]}`).
- Social posts are included on this calendar. They are one feature of **Show**, not a beta gate. **Ads** (`/ads`) is the sidebar row that still needs social beta.
- A Contact follow-up is an all-day item on its date; a Marketing piece opens its Project file only once the file exists.
- Empty week/month is valid. Copy **No scheduled releases match these filters.** is the empty filter state, not a routing failure.
- Creating tasks from the calendar is out of scope for this landing entry.
