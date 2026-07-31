# Browse agents

Browse agents lets a signed-in user open the agents catalog, inspect the list, and open an agent detail page when catalog data exists.

## Sub-features

- `agents-list` loads `/agents` for a signed-in user.
- `agents-open-detail` opens `/agents/[agentId]` from a list entry when at least one agent is listed.
- `agents-empty-or-error` distinguishes an empty/broken catalog (missing `credit_cost` on empty local DB) from a healthy list.

## How to get to it (user POV)

- Choose Agents in app navigation.
- Open `/agents` directly.
- From an agent card or row, open that agent’s detail URL.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)); session healthy.
- `verify-sokosumi doctor` ok.
- Prefer a Neon fork or seeded catalog; empty local Postgres may 500 until credit costs exist.

- **Open catalog.** Run `agent-browser open http://localhost:3000/agents` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. Page is `/agents` and not `/signin`.
- **Healthy list.** Snapshot shows one or more agent links/cards. Note one agent name and its href.
- **Open detail.** Click that agent control (ref from snapshot). URL matches `/agents/<id>` (optional `/jobs` child). Detail shows the same agent identity.
- **Empty/error path.** If the page errors or shows no agents, capture screenshot + snapshot and stop. Report unmet catalog precondition — do not invent hire/job success.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/browse-agents` then screenshot + `snapshot -i` for list and (if reached) detail under that directory.

## Gotchas

- Catalog depends on Core `GET /v1/agents` and credit-cost rows; local empty DB often fails here even when auth works.
- Do not treat a marketing/landing redirect as catalog proof.
- Hire/run-job flows are out of scope for this feature file — list + detail only.
