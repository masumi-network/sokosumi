# Projects

Projects lets a signed-in user open `/projects` and see their projects as a card grid (including an empty state).

## Sub-features

- `projects-open` loads `/projects` while authenticated.
- `projects-list-or-empty` shows project cards **or** heading “No projects yet”. Open / Hidden / Closed filters are on the page. **Recent activity** sits beside the grid on Open only.
- `projects-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Open the project picker in the header. Select **Open projects page**, the maximize icon beside **Create project**.
- Open `/projects` directly.
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
- The default Open view, with nothing in any view, uses heading **No projects yet**. **Hidden** with nothing hidden uses **No hidden projects**. **Closed** with nothing closed uses **No closed projects**. Open with projects only in another view uses **No open projects** or **All projects are closed**. A search miss uses **No projects match "…"**, not those titles.
- Creating a project (`?create=true` / modal) is out of scope for this entry; list/empty landing only.
- There is no **Projects** or **Overview** sidebar row. **Overview** is the first item in the header project picker once a project is selected. **Open projects page** in that same menu opens `/projects`.
