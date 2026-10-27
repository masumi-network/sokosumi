# Chat landing

Chat landing is the authenticated default home: after sign-in the user reaches Welcome at `/` (not `/chat`). This feature verifies routing and shell, not realtime messaging.

## Sub-features

- `welcome-default-landing` reaches `/` after authentication (or via authenticated root).
- `welcome-shell` shows Welcome chrome for the signed-in user. Without a personal Soko Bot that is a greeting, a coworker picker, and start-chat controls. With a personal Soko Bot, `/` is that bot's home instead. Shared bots do not replace Welcome. App nav is present either way.
- `chat-ably-gap` records when Ably placeholders break messaging UI without failing the landing proof.
- `chat-route-adjacent` (optional) notes `/chat`: mobile chats list; desktop (`md+`) redirects to `/`.

## How to get to it (user POV)

- Sign in and follow the default post-login redirect (Welcome `/`).
- Open `/` while authenticated (stays on Welcome).
- Open `/chat` only as an adjacent surface (mobile list / desktop redirect) — not the default landing.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open landing.** Run `agent-browser open $WEB_URL/` then wait for the URL to stay on `/`. Do not `wait --load networkidle` on Welcome/chat — Ably can hang that wait.
- **Confirm URL.** Run `agent-browser get url`. URL is `/` (or ends with `/`) and is not `/signin`.
- **Confirm shell.** Run `agent-browser snapshot -i`. Without a personal Soko Bot, expect a Welcome greeting (e.g. **Welcome, …!**) and/or coworker picker / **Chat with …** plus sidebar nav — not `[data-testid="multimodal-input"]` (removed from Welcome). With a personal Soko Bot, expect that bot's home on `/` instead of the coworker greeting. Either shell counts.
- **Optional `/chat`.** Open `$WEB_URL/chat`; mobile may keep `/chat`, desktop (`md+`) replaces to `/`. Either is fine; do not require `/chat` as the post-login default.
- **Ably note.** If a **Chat error** boundary or **Something went wrong** app error card/overlay appears from Ably auth failure, screenshot it and continue — landing still counts if URL and chrome prove Welcome `/`. Do not claim message send/receive unless Ably keys are real.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/chat-landing`, save snapshot, `agent-browser screenshot`, copy newest shot into that directory.

## Gotchas

- `DEFAULT_AUTHENTICATED_LANDING_PATH` is `/` (`landing-path.ts`). Proxy keeps authenticated `/` as Welcome — it does **not** hop to `/chat`.
- A personal Soko Bot replaces the coworker greeting with Soko Bot home on the same URL. Cloud-agent fixture Alice has no personal bot, so the proved shell is **Welcome, Alice!** and the coworker picker (**Chat with Alex**). Do not fail that path for a missing bot home, and do not require the coworker greeting when home is the bot chat.
- Ably placeholder keys make `POST /api/ably/auth` fail; that is an environment gap, not a routing regression.
- Proving a chat **message** requires configured Ably — out of scope unless keys are set.
- `/` while logged out is not this feature; use [Sign in](./sign-in.md).
