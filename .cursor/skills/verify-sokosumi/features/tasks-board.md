# Tasks board

Tasks board lets a signed-in user open `/tasks` and see the task manager (board or list; kanban columns in board mode).

## Sub-features

- `tasks-open` loads `/tasks` while authenticated.
- `tasks-board-shell` shows kanban column headings (**Backlog**, **Todo**, **In progress**, **Input required**, **Done**) in board mode, or list-mode chrome (flat rows or “No tasks”). Empty columns / “No tasks” are valid.
- `tasks-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Tasks** in app navigation.
- Open `/tasks` directly.
- Use **New task** from the sidebar when creating a task (create flow is out of scope for this file).

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open board.** Run `agent-browser open $WEB_URL/tasks` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays `/tasks` (not `/signin`).
- **Confirm shell.** Snapshot shows five kanban column headings (**Backlog** / **Todo** / **In progress** / **Input required** / **Done**), **or** list-mode chrome (flat rows or “No tasks”). Note which. Prefer setting `tasks_view_mode=board` so column headings are visible. There is no Board / Calendar tablist and no `tab` role.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/tasks-board` then screenshot + snapshot.

## Gotchas

- Empty columns / list empty-state (“No tasks”) are valid — do not require existing tasks. There is no onboarding overlay.
- Column headings match i18n (`App.Tasks.Columns.*`): **Backlog**, **Todo**, **In progress**, **Input required**, **Done**. They are not CSS `uppercase`, and "In progress" / "Input required" are not Title Case.
- Prefer **explicit** board mode. agent-browser 0.36+: `agent-browser cookies set tasks_view_mode board --url "$WEB_URL" --secure` then reload. Do **not** pass `name=value` as one argument (`tasks_view_mode=board`) — CDP returns `Invalid cookie fields`. Absent cookie → **list** on mobile/tablet UA, board on desktop. **List mode does not render kanban column headers** (flat rows or “No tasks”); only board mode shows Backlog…Done.
- Creating or editing a task is out of scope; this feature proves landing + board/list shell only.
- Calendar is its own page ([Calendar](./calendar.md)). `/tasks?tab=calendar` redirects to `/calendar`. Do not look for a Calendar tab on `/tasks`. There is no Jobs tab.
