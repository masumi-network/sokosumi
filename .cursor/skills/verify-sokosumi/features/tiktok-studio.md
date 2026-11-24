# TikTok Studio

TikTok Studio is a Marketing destination at `/tiktok-studio` for talking videos and shorts. A video belongs to one project. With no project in scope the page asks you to choose one.

## Sub-features

- `tiktok-open` loads `/tiktok-studio` while authenticated.
- `tiktok-no-project` shows heading **Choose a project** and the body that a video belongs to a project. **Create project** may be present when the workspace has no projects. That is success when the header scope is **All projects**.
- `tiktok-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **TikTok Studio** in the desktop sidebar **Marketing** group (after **Content Studio**, before **Social posts**).
- Open `/tiktok-studio` directly. A project-scoped URL is `/tiktok-studio?projectId=…`.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open TikTok Studio.** Run `agent-browser open $WEB_URL/tiktok-studio` then `agent-browser wait --load load` and `agent-browser snapshot -i`. URL stays `/tiktok-studio` (not `/signin`).
- **Confirm shell.** With no project selected, snapshot shows heading **Choose a project**. **Create project** is expected when the workspace has no projects; **Select project** when it has some. Do not make a video or create a project.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/tiktok-studio` then screenshot + snapshot.

## Gotchas

- This is not [Content Studio](./studio.md). Content Studio's empty scope button is **Start from a website**. This page's heading is **Choose a project**.
- The row is always in Marketing, including workspaces where **Newsletter** is absent.
- Writing a script, picking a presenter, or posting to TikTok is out of scope for this landing check.
