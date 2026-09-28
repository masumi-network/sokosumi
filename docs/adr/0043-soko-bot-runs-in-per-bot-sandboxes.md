# Soko Bot runs in a per-bot Vercel Sandbox

- Status: Accepted (2026-09-28). Amends [ADR 0007](0007-soko-bot-eve-runtime.md).

Each Soko Bot's agent loop runs in that bot's own persistent Vercel Sandbox
(`soko-bot-<botId>`, region `fra1`), not inside Core. The bot gets the tools
that were disabled when it last had its own runtime — web search and fetch, a
shell, a workspace that persists between turns, a plan, and a read-only
research helper — and turns may run until the 15-minute turn deadline instead
of Core's 240-second budget.

Core stays the control plane and the only holder of credentials. The runner
(`apps/core/src/soko-bot-runner`, bundled to `dist/soko-bot-runner.mjs` and
copied into the sandbox, re-verified by hash on every launch) talks to Core over
`/v1/soko-bot-runtime/turns/{turnId}/…`:

- **Authorization.** A per-turn HMAC token, derived from `BETTER_AUTH_SECRET`,
  expiring with the turn. The sandbox network proxy injects it on requests to
  that turn's paths, so no process in the sandbox holds it.
- **Models.** The runner points the AI SDK gateway provider at Core. Core
  checks the model is the turn's version model, overwrites the routing options
  with the EU policy, adds the Gateway key, verifies the inference region, and
  writes the metered `step.completed` itself. Runner-reported usage is never
  used for billing.
- **Sokosumi tools.** Executed by Core exactly as before: grants, receipts,
  idempotency, lease and deadline checks.
- **Sandbox tools** are capabilities like any other. Owner routes carry them;
  the teammate and bot-to-bot ceilings and every turn Core composes itself
  (mail, task-board and delegation events, built-in rhythms) do not.
- **Untrusted input.** Before any sandbox tool other than the plan runs, and
  when the Gateway reports a web search, Core records that the turn read
  untrusted input. From then on it refuses hiring, job input, integration
  actions, file uploads and posting to chat; the bot proposes them with
  `request_user_decision` instead.
- **Network.** Open internet, private and link-local ranges denied.

The in-process runtime remains for preview evaluation runs (their per-call
ledger lives in Core) and as `SOKO_BOT_RUNTIME_ADAPTER=in-process`. It offers
no sandbox tools.

What this costs: a sandbox start (~1 s) per turn, and a public Core URL the
sandbox can reach — locally that means a tunnel or
`scripts/soko-bot-runner-local.mts`, which runs the runner on the developer's
machine against localhost.
