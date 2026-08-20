# Tasks board

Tasks board lets a signed-in user open `/tasks` and see the task manager (kanban columns and/or Jobs tab chrome).

## Sub-features

- `tasks-open` loads `/tasks` while authenticated.
- `tasks-board-shell` shows Tasks/Jobs tabs and kanban column headings (BACKLOG, TODO, IN PROGRESS, INPUT REQUIRED, DONE) or an empty-state onboarding path.
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
- **Confirm shell.** Snapshot shows Tasks/Jobs tablist and five kanban column headings (**BACKLOG** / **TODO** / **IN PROGRESS** / **INPUT REQUIRED** / **DONE**, or Title Case equivalents), **or** a tasks empty-state / list-mode chrome with the same tabs. Note which.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/tasks-board` then screenshot + snapshot.

## Gotchas

- Empty columns / empty-state onboarding are valid — do not require existing tasks.
- i18n strings are Title Case; CSS `uppercase` often makes the a11y tree show ALL CAPS — either form is success.
- Prefer board mode (`tasks_view_mode=board` or clear the cookie). List mode with tasks still shows column headers; an **empty** list drops them for a placeholder. Tasks/Jobs tabs alone still count as shell.
- Creating or editing a task is out of scope; this feature proves landing + board shell only.
- Jobs tab on the same page is adjacent UI — proving Tasks tab shell is enough for this entry.
