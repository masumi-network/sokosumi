# Files

Files lets a signed-in user open `/drive` (nav label **Files**) and see Recents, Workspace, or Tables, including empty states. Desktop puts **Files** in the main sidebar; mobile keeps it on the You page.

## Sub-features

- `files-open` loads `/drive` while authenticated.
- `files-recents-or-empty` shows Recents rows or “No recent files”. A failed load is an inline alert **Failed to load recent files** with **Retry** (placeholder Blob tokens) — environment gap, not a routing failure.
- `files-workspace-or-empty` shows the **Workspace** tab (canonical `?view=workspace`; `browse` / `all` are aliases). Chrome includes **Upload**, **New**, list/grid. **New** opens **Create new folder**. Empty catalog copy is **Your files will appear here**. A search miss uses **No accessible matches**. Workspace root may show a **Sokosumi Projects** folder row (`tasksFolder`) — that is browse chrome, not a header button. Heading **No files yet** is leftover copy for some task/legacy paths, not the main Workspace empty. A failed catalog load is an inline alert **Search could not be completed.** with **Retry** — environment gap, same class as Recents.
- `files-tables` is adjacent chrome on the same page (third tab). Landing proof does not require driving Tables.
- `files-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Desktop: choose **Files** in the sidebar **Records** group (with **Contacts**), above **Marketing**. **Social posts** is always in Marketing. **Ads** is always there too.
- Mobile: open **You**, then **Files**.
- Open `/drive` directly.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.
- Prefer a desktop viewport so **Files** is in the sidebar.

- **Open Files.** Run `agent-browser open $WEB_URL/drive` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays `/drive` (not `/signin`).
- **Recents.** Snapshot shows tabs **Recents** | **Workspace** | **Tables**, Recents selected, and either recent-file rows or heading **No recent files**. An inline alert **Failed to load recent files** with **Retry** (dummy Vercel Blob tokens) is an environment gap — landing still counts if the Files shell and tabs are present.
- **Workspace.** Select **Workspace** or open `$WEB_URL/drive?view=workspace`. Snapshot shows browse chrome (**Upload**, **New**, list/grid). **New** opens the create-folder dialog (title **Create new folder**). Do not require uploaded files. A **Sokosumi Projects** folder row at the Workspace root is valid chrome (`?view=tasks`) and may be the only row — empty catalog heading **Your files will appear here** shows when there are no files, and may be absent while that folder row is present. An inline alert **Search could not be completed.** with **Retry** is an environment gap — landing still counts if the Files shell and tabs are present.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/files` then screenshot + snapshot of Recents and Workspace.

## Gotchas

- Nav label is **Files**; the route is `/drive`.
- The browse tab label is **Workspace**, not **My files**. `myDrive` (**My files**) is used as a workspace-root label (for example copy dialogs), not the tab.
- Canonical browse URL is `?view=workspace`. `?view=browse` still opens Workspace as a legacy alias.
- Desktop **Records** is **Contacts** then **Files**. **Marketing** (Content Studio, TikTok Studio, Social posts, SEO, Ads, Competitors) comes after Records. **Calendar** is a Work sidebar row after **Schedules**. Mobile does **not** show Files in the sidebar — use the You page. The **New** browse control is the create-folder action; do not look for a **Create folder** button label. There is no header **Tasks** button; **Sokosumi Projects** is a folder-nav virtual row that opens `?view=tasks`.
- Recents calls `GET /v1/drive/recents`, which needs a real Blob token. Missing token is Core **503**; placeholder tokens show an inline alert **Failed to load recent files** with **Retry**. The Workspace catalog calls `GET /v1/drive/search` and, on failure, an inline alert **Search could not be completed.** with **Retry**. Those are environment gaps, not proof the route is missing. `GET /v1/drive/files` is a different list used outside this catalog.
- Upload, rename, delete, Tables contents, project File Browser (`/drive?view=tasks&projectId=…`), and data rooms are out of scope for this landing entry. A Workspace folder's **Data room** action opens `/drive/data-rooms/[id]` (`apps/web/src/app/(app)/drive/data-rooms/[id]/page.tsx`).
