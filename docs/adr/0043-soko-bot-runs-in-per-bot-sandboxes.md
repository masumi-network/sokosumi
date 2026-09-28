# Soko Bot turns run in a fresh Vercel Sandbox with a persistent workspace

- Status: Accepted (2026-09-28). Amends [ADR 0007](0007-soko-bot-eve-runtime.md).

Each Soko Bot turn runs its agent loop in a new Vercel Sandbox VM
(`soko-bot-turn-<turnId>`, region `fra1`), not inside Core. The bot's workspace
is a Vercel Drive (`soko-bot-<botId>`, `fra1`) mounted at
`/vercel/sandbox/workspace`; it is the only thing that outlives a turn. The bot
gets the tools that were disabled when it last had its own runtime — web search
and fetch, a shell, workspace files, a plan, and a read-only research helper —
and turns may run until the 15-minute turn deadline instead of Core's
240-second budget.

A fresh VM per turn is the security boundary between turns: nothing a turn
installs, rewrites or leaves running reaches the next one. A Drive attaches to
one VM at a time, so a launch first stops any VM still holding it.

Core stays the control plane and the only holder of credentials. The runner
(`apps/core/src/soko-bot-runner`, bundled to `dist/soko-bot-runner.mjs` and
written into each new VM) talks to Core over
`/v1/soko-bot-runtime/turns/{turnId}/…`:

- **Authorization.** A per-turn HMAC token, derived from `BETTER_AUTH_SECRET`,
  expiring with the turn. The sandbox network proxy injects it on requests to
  that turn's paths, so no process in the VM holds it.
- **Models.** The runner points the AI SDK gateway provider at Core. Core
  checks the model is the turn's version model, forwards only the Gateway
  protocol headers, replaces the provider options with the model policy's
  (EU pinning, or zero retention for an owner-approved global agent model
  such as GPT-6 Luna), adds the Gateway key, meters the step itself, and
  then checks the reported region.
- **Sokosumi tools.** Executed by Core exactly as before: grants, receipts,
  idempotency, lease and deadline checks.
- **Sandbox tools** are capabilities like any other. Owner routes carry them;
  the teammate and bot-to-bot ceilings and every turn Core composes itself
  (mail, task-board and delegation events, built-in rhythms) do not. Each
  call is recorded as a tool-call row without an actor bot (never a receipt)
  holding its clipped output and citable sources.
- **Untrusted input.** Before any sandbox tool other than the plan runs, and
  when the Gateway reports a web search, Core records that the turn read
  untrusted input. From then on it refuses hiring, job input, integration
  actions, uploads, image generation, chat posts, task comments and
  assignments, and schedule changes; the bot proposes them with
  `request_user_decision` instead.
- **Network.** Open internet; IPv4 private and link-local ranges denied.

Known limits:

- The sandbox firewall accepts IPv4 CIDRs only, so IPv6 private ranges are not
  denied.
- Web search runs on Perplexity through the AI Gateway, outside the EU, as the
  Jev route classifier does. Queries are the model's search terms.

The in-process runtime remains for preview evaluation runs (their per-call
ledger lives in Core) and as `SOKO_BOT_RUNTIME_ADAPTER=in-process`, which local
development uses without a tunnel. It offers no sandbox tools.
