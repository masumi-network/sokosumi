# History

Credit History lets a signed-in user open `/history` and see their credit ledger (agent jobs, images, tasks, coworkers, Soko Bots, top-ups), including an empty state.

## Sub-features

- `history-open` loads `/history` while authenticated.
- `history-list-or-empty` shows either ledger rows or a clear empty state (**No transactions yet**).
- `history-gated` redirects anonymous users away from `/history` toward sign-in.

## How to get to it (user POV)

- Desktop: open the account menu → **Credit History**.
- Mobile: You page → **Credit History** (`you-history`).
- Open `/history` directly.
- Not a desktop sidebar row.

## Driving it with agent-browser

Preconditions:

- Signed in for the happy path (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open history.** Run `agent-browser open $WEB_URL/history` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL is `/history` (not `/signin`).
- **List or empty.** Snapshot shows transaction rows **or** heading **No transactions yet**. Either is success; note which. Filters include Source values **Agent job** / **Image** / **Task** / **Coworker** / **Soko Bot** / **Top up** / **Other**. Do not require spend rows for a new fixture user.
- **Optional gate check.** In a fresh browser session without cookies, open `/history` and confirm redirect to `/signin?returnUrl=%2Fhistory`. Do not reuse `AGENT_BROWSER_SESSION` / `AGENT_BROWSER_SESSION_NAME` for this check (use another `--session` / `AGENT_BROWSER_SESSION` value, or `agent-browser close` then a new session). After `agent-browser close`, open the URL again before `get url` (a close can leave `about:blank`). Wait for network idle before `get url` / snapshot so the session is fully attached.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/history` then screenshot + snapshot of the authenticated history view.

## Gotchas

- Empty Credit History is valid proof for a new fixture user — do not require existing spend. Empty heading is **No transactions yet** (not “No history yet”). Subtitle mentions jobs, images, other spend, and top-ups — not conversations.
- Do not open agent job detail (`/agents/.../jobs/...`) and call it history; that is a different route.
- Nav label is **Credit History**, not “History” or “Jobs”. The page is a credit ledger (`GET /v1/transactions`), not a generic task/job/image activity feed.
