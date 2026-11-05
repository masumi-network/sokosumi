# Projects

Projects lets a signed-in user open `/projects` and see their projects as a card grid (including an empty state).

## Sub-features

- `projects-open` loads `/projects` while authenticated.
- `projects-list-or-empty` shows project cards **or** heading “No projects yet”. Open / Hidden / Closed filters and a **Recent activity** column are part of the same page.
- `projects-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Desktop: **Work** → **Projects** (directly under **Home**). When a project is already in scope, that row is **Overview** and opens that project instead of the list.
- Open `/projects` directly. The header scope control lists projects and **Create project**. It has no **Manage projects** row.
- Mobile: choose **Projects** in the bottom tabs.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open projects.** Run `agent-browser open $WEB_URL/projects` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays `/projects` (not `/signin`).
- **List or empty.** Snapshot shows project cards **or** heading “No projects yet”, plus **Open** / **Hidden** / **Closed**. Either population is success; note which.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/projects` then screenshot + snapshot.

## Gotchas

- Empty projects is valid for a new fixture user — do not require existing projects.
- True empty uses heading **No projects yet**. A search/filter miss uses **No projects match "…"**, not the empty title.
- Creating a project (`?create=true` / modal) is out of scope for this entry; list/empty landing only.
- Desktop **Work** includes **Projects** (or **Overview** when a project is scoped). Do not look for **Manage projects**.
