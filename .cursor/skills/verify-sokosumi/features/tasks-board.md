# Tasks board

Tasks board lets a signed-in user open `/tasks` and see the task manager (kanban columns and/or Jobs tab chrome).

## Sub-features

- `tasks-open` loads `/tasks` while authenticated.
- `tasks-board-shell` shows Tasks/Jobs tabs and kanban column headings (**Backlog**, **Todo**, **In Progress**, **Input Required**, **Done**) or list-mode chrome with the same tabs (empty columns / “No tasks” are valid).
- `tasks-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Tasks** in app navigation.
- Open `/tasks` directly.
- Use **New Task** from the sidebar when creating a task (create flow is out of scope for this file).

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open board.** Run `agent-browser open $WEB_URL/tasks` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays `/tasks` (not `/signin`).
- **Confirm shell.** Snapshot shows Tasks/Jobs tablist and five kanban column headings (**Backlog** / **Todo** / **In Progress** / **Input Required** / **Done**), **or** list-mode chrome with the same tabs (flat rows or “No tasks”). Note which.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/tasks-board` then screenshot + snapshot.

## Gotchas

- Empty columns / list empty-state (“No tasks”) are valid — do not require existing tasks. There is no onboarding overlay.
- Column headings are Title Case from i18n (`App.Tasks.Columns.*`); the header has no CSS `uppercase`.
- Prefer **explicit** board mode. agent-browser 0.36+: `agent-browser cookies set tasks_view_mode board --url "$WEB_URL" --secure` then reload. Do **not** pass `name=value` as one argument (`tasks_view_mode=board`) — CDP returns `Invalid cookie fields`. Absent cookie → **list** on mobile/tablet UA, board on desktop. **List mode does not render kanban column headers** (flat rows or “No tasks”); only board mode shows Backlog…Done. Tasks/Jobs tabs alone still count as shell.
- Creating or editing a task is out of scope; this feature proves landing + board shell only.
- Jobs tab on the same page is adjacent UI — proving Tasks tab shell is enough for this entry.
