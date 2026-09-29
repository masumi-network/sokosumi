# Files

Files lets a signed-in user open `/drive` (nav label **Files**) and see Recents, Workspace, or Tables, including empty states. Desktop puts **Files** in the main sidebar; mobile keeps it on the You page.

## Sub-features

- `files-open` loads `/drive` while authenticated.
- `files-recents-or-empty` shows Recents rows or “No recent files” (placeholder Blob tokens may toast **Failed to load recent files** — environment gap, not a routing failure).
- `files-workspace-or-empty` shows the **Workspace** tab (canonical `?view=workspace`; `browse` / `all` are aliases). Chrome includes **Upload**, **New**, list/grid, and a header **Tasks** button (not a root folder row). **New** opens **Create new folder**. Empty catalog copy is **Your files will appear here**. A search miss uses **No accessible matches**. Heading **No files yet** is leftover copy for some task/legacy paths, not the main Workspace empty. Placeholder Blob tokens may toast **Failed to load files** — environment gap, same class as Recents.
- `files-tables` is adjacent chrome on the same page (third tab). Landing proof does not require driving Tables.
- `files-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Desktop: choose **Files** in app navigation (after Content Studio; Social sits between Studio and Files when the social beta row is on).
- Mobile: open **You**, then **Files**.
- Open `/drive` directly.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.
- Prefer a desktop viewport so **Files** is in the sidebar.

- **Open Files.** Run `agent-browser open $WEB_URL/drive` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays `/drive` (not `/signin`).
- **Recents.** Snapshot shows tabs **Recents** | **Workspace** | **Tables**, Recents selected, and either recent-file rows or heading **No recent files**. A toast **Failed to load recent files** with dummy Vercel Blob tokens is an environment gap (same class as Ably placeholders) — landing still counts if the Files shell and tabs are present.
- **Workspace.** Select **Workspace** or open `$WEB_URL/drive?view=workspace`. Snapshot shows browse chrome (**Upload**, **New**, list/grid) and header **Tasks**. **New** opens the create-folder dialog (title **Create new folder**). Empty catalog heading is **Your files will appear here** — do not require uploaded files or a root **Tasks** folder row. A toast **Failed to load files** with dummy Vercel Blob tokens is an environment gap — landing still counts if the Files shell and tabs are present.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/files` then screenshot + snapshot of Recents and Workspace.

## Gotchas

- Nav label is **Files**; the route is `/drive`.
- The browse tab label is **Workspace**, not **My Files**. `myDrive` (**My Files**) is used as a workspace-root label (for example copy dialogs), not the tab.
- Canonical browse URL is `?view=workspace`. `?view=browse` still opens Workspace as a legacy alias.
- Desktop main nav includes Files after Calendar / Content Studio (and after **Social** when that beta row is on). Mobile does **not** show Files in the sidebar — use the You page. The **New** browse control is the create-folder action; do not look for a **Create folder** button label. Header **Tasks** navigates to `?view=tasks`.
- Recents calls `GET /v1/drive/recents`, which needs a real Blob token. Missing token is Core **503**; placeholder tokens may toast **Failed to load recent files**. Browse list calls `GET /v1/drive/files` and may toast **Failed to load files**. Those are environment gaps, not proof the route is missing.
- Upload, rename, delete, Tables contents, and project File Browser (`/drive?view=tasks&projectId=…`) are out of scope for this landing entry.
