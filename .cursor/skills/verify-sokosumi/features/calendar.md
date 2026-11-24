# Calendar

Calendar is a destination of its own (`/calendar`, a **Calendar** row in the sidebar's Work group after **Schedules**). It shows everything with a date in Month / Week / Agenda: Tasks, Social posts, Newsletter issues, Follow-ups, Marketing strategy, and Soko Bot runs. Each feature is a checkbox under **Show**, opened from the **Show & filter** button.

## Sub-features

- `calendar-open` loads `/calendar` while authenticated. The URL may gain `?timezone=…`.
- `calendar-shell` shows Month / Week / Agenda tabs, the **Show & filter** button and the period grid (empty copy **Nothing scheduled matches these filters.** is valid).
- `calendar-show` is the menu behind **Show & filter**. Its **Show** section has one checkbox per feature the workspace offers: **Tasks**, **Social posts**, **Newsletter** (only where the workspace has it), **Follow-ups**, **Marketing strategy**, and **Soko Bot**. It writes `types=…` to the URL (absent means every offered feature).
- `calendar-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Calendar** in the sidebar (Work group, after **Schedules**). It follows the header's Project scope (`?projectId=`); **All projects** shows the workspace.
- Open `/calendar` directly.
- Old links still work: `/tasks?tab=calendar` and `socialOnly=true` open `/calendar` (the latter as `types=social`). `/newsletter/calendar` is not that redirect. When the beta is on it is the newsletter issue calendar, and **Open full calendar** links to `/calendar?types=newsletter`. Outside the beta it is the same 404 as `/newsletter`.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open calendar.** Run `agent-browser open $WEB_URL/calendar` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays on `/calendar` (query string such as `timezone=UTC` is fine) and is not `/signin`. Opening `$WEB_URL/tasks?tab=calendar` redirects to the same page.
- **Confirm shell.** Snapshot shows **Month** / **Week** / **Agenda** (`calendar-views`), a **Show & filter** button and calendar chrome (period controls + weekday headers). Empty filter copy is success — do not require events. Creating a scheduled task from a slot is out of scope.
- **Try Show.** Click **Show & filter**, then in **Show** uncheck features until only **Social posts** is left: the URL gains `types=social`, **Agenda** disappears and the status summary appears. The last feature cannot be unchecked. The checkbox labels are **Tasks**, **Social posts**, **Follow-ups**, **Marketing strategy**, and **Soko Bot** (**Newsletter** only when that workspace has it).
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/calendar` then screenshot + snapshot.

## Gotchas

- Calendar is not a Tasks tab any more; `TASKS_TAB_VALUES` is gone. Social embeds the same component locked to Social posts (`types={["social"]}`).
- Social posts are included on this calendar. They are one feature under **Show**, not a beta gate. **Ads** (`/ads`) is always a Marketing sidebar row.
- A follow-up is an all-day item on its date; a marketing-strategy piece opens its Project file only once the file exists. The button's accessible name can include an active-filter count (**Show & filter, 1 active filter**). Match **Show & filter**, not a control named only **Show**.
- Empty week/month is valid. Copy **Nothing scheduled matches these filters.** is the empty filter state, not a routing failure.
- Creating tasks from the calendar is out of scope for this landing entry.
