# Files

Files lets a signed-in user open `/drive` (nav label **Files**) and see Recents or My Files, including empty states. Desktop puts **Files** in the main sidebar; mobile keeps it on the You page.

## Sub-features

- `files-open` loads `/drive` while authenticated.
- `files-recents-or-empty` shows Recents rows or “No recent files” (placeholder Blob tokens may toast **Failed to load recent files** — environment gap, not a routing failure).
- `files-my-files-or-empty` shows My Files browse chrome (Upload / Create folder / list-grid) and rows or “No files yet”.
- `files-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Desktop: choose **Files** in app navigation.
- Mobile: open **You**, then **Files**.
- Open `/drive` directly.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.
- Prefer a desktop viewport so **Files** is in the sidebar.

- **Open Files.** Run `agent-browser open $WEB_URL/drive` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays `/drive` (not `/signin`).
- **Recents.** Snapshot shows Recents / My Files tabs and either recent-file rows or heading **No recent files**. A toast **Failed to load recent files** with dummy Vercel Blob tokens is an environment gap (same class as Ably placeholders) — landing still counts if the Files shell and tabs are present.
- **My Files.** Select the **My Files** tab (or open `$WEB_URL/drive?view=browse`). Snapshot shows browse chrome (**Upload**, **Create folder**, list/grid). Empty is valid (**No files yet** or an empty list). Do not require existing files.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/files` then screenshot + snapshot of Recents and My Files.

## Gotchas

- Nav label is **Files**; the route is `/drive`.
- Desktop main nav includes Files after Tasks (and after Schedules when that beta item is on). Mobile does **not** show Files in the sidebar — use the You page.
- Recents calls `GET /v1/drive/recents`, which needs a real Blob token. Placeholder local tokens 500 with **Failed to load recent files**; that is not proof the route is missing.
- Upload, rename, delete, and project File Browser (`/drive?view=tasks&projectId=…`) are out of scope for this landing entry.
