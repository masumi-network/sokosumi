# Chat landing

Chat landing is the authenticated default home: after sign-in the user reaches `/` (not `/chat`). Without a personal Soko Bot the page is **Get your Soko Bot**. With one, it is that bot's home. This feature verifies routing and shell, not realtime messaging.

## Sub-features

- `welcome-default-landing` reaches `/` after authentication (or via authenticated root).
- `welcome-shell` shows the signed-in home. Without a personal Soko Bot that is the heading **Get your Soko Bot**, a short intro, and **Set it up** (opens `/personal-assistant?from=home`). That path has no coworker picker and no **Needs you**. With a personal Soko Bot, `/` is that bot's home (composer included; **Needs you** can appear there). Shared bots do not replace home. App nav is present either way. **Catch up** in the sidebar opens `/chat/catch-up`; it is not the home page.
- `chat-ably-gap` records when Ably placeholders break messaging UI without failing the landing proof.
- `chat-route-adjacent` (optional) notes `/chat`: mobile chats list; desktop (`md+`) redirects to `/`.

## How to get to it (user POV)

- Sign in and follow the default post-login redirect (`/`).
- Open `/` while authenticated (stays on `/`).
- Open `/chat` only as an adjacent surface (mobile list / desktop redirect) — not the default landing.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open landing.** Run `agent-browser open $WEB_URL/` then wait for the URL to stay on `/`. Do not `wait --load networkidle` on Home `/` or `/chat` — Ably can hang that wait.
- **Confirm URL.** Run `agent-browser get url`. URL is `/` (or ends with `/`) and is not `/signin`. The tab title is **Home**.
- **Confirm shell.** Run `agent-browser snapshot -i`. Without a personal Soko Bot, expect heading **Get your Soko Bot** and **Set it up**, plus sidebar nav, and no home composer. Not **Chat with …**. A sidebar **Catch up** link is normal. With a personal Soko Bot, expect that bot's home on `/` (greeting **What's next, …?** and a composer). Either shell counts for its user. There is no `[data-testid="multimodal-input"]` in the app.
- **Optional `/chat`.** Open `$WEB_URL/chat`; mobile may keep `/chat`, desktop (`md+`) replaces to `/`. Either is fine; do not require `/chat` as the post-login default.
- **Ably note.** If a **Chat error** boundary or **Something went wrong** app error card/overlay appears from Ably auth failure, screenshot it and continue — landing still counts if URL and chrome prove `/`. Do not claim message send/receive unless Ably keys are real.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/chat-landing`, save snapshot, `agent-browser screenshot`, copy newest shot into that directory.

## Gotchas

- Signed-in people on auth pages are redirected to `/`. The proxy does not choose that page: with a session cookie it continues, and it does **not** hop `/` to `/chat`. Anonymous users go to `/signin`.
- A personal Soko Bot replaces **Get your Soko Bot** with that bot's home on the same URL. Cloud-agent fixture Alice has no personal bot, so the proved shell is **Get your Soko Bot** and **Set it up**. Coworker **Chat with …** lives on `/agents`, not on `/`. Do not require the bot home when the user has no bot, and do not require the setup screen when home is the bot.
- Ably placeholder keys make `POST /api/ably/auth` fail; that is an environment gap, not a routing regression.
- Proving a chat **message** requires configured Ably — out of scope unless keys are set.
- `/` while logged out is not this feature; use [Sign in](./sign-in.md).
