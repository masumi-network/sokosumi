# Jobs history

Jobs history lets a signed-in user open `/history` and see their unified History list of **tasks and jobs** (including an empty state).

## Sub-features

- `history-open` loads `/history` while authenticated.
- `history-list-or-empty` shows either history rows (task and/or job) or a clear empty state (“No history yet”).
- `history-gated` redirects anonymous users away from `/history` toward sign-in.

## How to get to it (user POV)

- Choose **History** in app navigation.
- Open `/history` directly.

## Driving it with agent-browser

Preconditions:

- Signed in for the happy path (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open history.** Run `agent-browser open http://localhost:3000/history` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL is `/history` (not `/signin`).
- **List or empty.** Snapshot shows history rows **or** heading “No history yet”. Either is success; note which. Do not require job-only rows — the page is task + job history.
- **Optional gate check.** In a fresh browser session without cookies, open `/history` and confirm redirect to `/signin?returnUrl=%2Fhistory`. Do not reuse `AGENT_BROWSER_SESSION_NAME` for this check (use another session name or clear state). After `open`, wait for network idle before `get url` / snapshot so the session is fully attached.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/jobs-history` then screenshot + snapshot of the authenticated history view.

## Gotchas

- Empty history is valid proof for a new fixture user — do not require existing tasks/jobs.
- Do not open agent job detail (`/agents/.../jobs/...`) and call it history; that is a different route.
- Nav label is **History**, not “Jobs”.
