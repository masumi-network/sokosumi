# Soko Bots

Soko Bots lets a signed-in user open `/soko-bots` and see the team's personal assistants, including the empty "create your assistant" state.

## Sub-features

- `soko-bots-open` loads `/soko-bots` while authenticated.
- `soko-bots-hero` shows **Your team's personal assistants** and **Create your assistant**.
- `soko-bots-yours-or-empty` shows the user's assistant, or **You don't have an assistant yet**.
- `soko-bots-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Soko Bots** at the top of the desktop sidebar (above **New task**).
- Open `/soko-bots` directly.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open Soko Bots.** Run `agent-browser open $WEB_URL/soko-bots` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays `/soko-bots` (not `/signin`).
- **Confirm shell.** Snapshot shows **Your team's personal assistants** and **Create your assistant**. Fixture Alice with no assistant also shows **You don't have an assistant yet**. Do not require a roster of teammates.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/soko-bots` then screenshot + snapshot.

## Gotchas

- Bootstrap leaves `SOKO_BOT_ENABLED` false. The team read then 404s with **Soko Bot is not enabled**, and the page also shows **The team overview is not available right now.** The route and the create-assistant hero are still there. That line is an environment gap, not a missing page. Do not claim a populated roster.
- A personal Soko Bot also replaces the coworker greeting on [Chat landing](./chat-landing.md). This file is the `/soko-bots` roster, not that home.
- Creating an assistant is out of scope.
