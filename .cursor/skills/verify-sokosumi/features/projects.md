# Projects

Projects lets a signed-in user open `/projects` and see their project list (including an empty state).

## Sub-features

- `projects-open` loads `/projects` while authenticated.
- `projects-list-or-empty` shows project list rows **or** “No projects yet”.
- `projects-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Projects** in app navigation.
- Open `/projects` directly.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open projects.** Run `agent-browser open http://localhost:3000/projects` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays `/projects` (not `/signin`).
- **List or empty.** Snapshot shows project entries **or** heading “No projects yet”. Either is success; note which.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/projects` then screenshot + snapshot.

## Gotchas

- Empty projects is valid for a new fixture user — do not require existing projects.
- Creating a project (`?create=true` / modal) is out of scope for this entry; list/empty landing only.
