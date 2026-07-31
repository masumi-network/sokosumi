# Chat landing

Chat landing is the authenticated default home: after sign-in the user reaches `/chat` (or is redirected there). This feature verifies routing and shell, not realtime messaging.

## Sub-features

- `chat-default-landing` reaches `/chat` after authentication.
- `chat-shell` shows the chat app chrome for the signed-in user.
- `chat-ably-gap` records when Ably placeholders break messaging UI without failing the landing proof.

## How to get to it (user POV)

- Sign in and follow the default post-login redirect.
- Open `/` while authenticated (redirects to `/chat`).
- Open `/chat` directly.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open landing.** Run `agent-browser open http://localhost:3000/chat` then `agent-browser wait --load networkidle`.
- **Confirm URL.** Run `agent-browser get url`. URL contains `/chat` and is not `/signin`.
- **Confirm shell.** Run `agent-browser snapshot -i`. Authenticated chrome is present (welcome / composer / nav).
- **Ably note.** If a “Something went wrong” modal appears from Ably auth failure, screenshot it and continue — landing still counts if URL and chrome prove `/chat`. Do not claim message send/receive unless Ably keys are real.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/chat-landing`, save snapshot, `agent-browser screenshot`, copy newest shot into that directory.

## Gotchas

- Ably placeholder keys make `POST /api/ably/auth` fail; that is an environment gap, not a routing regression.
- Proving a chat **message** requires configured Ably — out of scope unless keys are set.
- `/` while logged out is not this feature; use [Sign in](./sign-in.md).
