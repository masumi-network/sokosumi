# Jobs history

Jobs history lets a signed-in user open `/history` and see their jobs list (including an empty state).

## Sub-features

- `history-open` loads `/history` while authenticated.
- `history-list-or-empty` shows either job rows or a clear empty state.
- `history-gated` redirects anonymous users away from `/history` toward sign-in.

## How to get to it (user POV)

- Choose History (or equivalent) in app navigation.
- Open `/history` directly.

## Driving it with agent-browser

Preconditions:

- Signed in for the happy path (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open history.** Run `agent-browser open http://localhost:3000/history` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL is `/history` (not `/signin`).
- **List or empty.** Snapshot shows a jobs table/list **or** an empty-state message. Either is success; note which.
- **Optional gate check.** In a fresh browser session without cookies, open `/history` and confirm redirect to sign-in. Do not reuse `AGENT_BROWSER_SESSION_NAME` for this check (use another `--session` or clear state).
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/jobs-history` then screenshot + snapshot of the authenticated history view.

## Gotchas

- Empty history is valid proof for a new fixture user — do not require existing jobs.
- Do not open agent job detail (`/agents/.../jobs/...`) and call it history; that is a different route.
