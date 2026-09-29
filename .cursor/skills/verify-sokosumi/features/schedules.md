# Schedules

Schedules lets a signed-in user open `/schedules` and see workspace task schedules (list or empty), filtered by project and state.

## Sub-features

- `schedules-open` loads `/schedules` while authenticated.
- `schedules-list-or-empty` shows schedule rows **or** “No schedules here yet. A schedule creates a new task every time it runs.”
- `schedules-state-tabs` shows All / Active / Paused / Ended.
- `schedules-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Schedules** in app navigation (desktop sidebar after Tasks; also on the You page).
- Open `/schedules` directly.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open schedules.** Run `agent-browser open $WEB_URL/schedules` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays `/schedules` (not `/signin`).
- **Confirm shell.** Snapshot shows the Schedule state tablist (**All** / **Active** / **Paused** / **Ended**) and either schedule rows or empty copy **No schedules here yet**. **New schedule** may be present. Creating a schedule is out of scope.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/schedules` then screenshot + snapshot.

## Gotchas

- Empty schedules is valid for a new fixture user — do not require existing schedules.
- This is not the [Calendar](./calendar.md) grid. Route constant is `TASK_SCHEDULES_PATH` (`/schedules`).
- Creating or editing a schedule is out of scope; landing + list/empty shell only.
