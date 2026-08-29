# Run Soko Bot inside Core

**Superseded 2026-08-27.** The original decision — a monorepo-owned Eve service
in `apps/soko-bot` with Core as control plane — is recorded at the bottom.

Soko Bot's agent loop runs inside `apps/core` behind the existing
`SokoBotRuntime` port, as the `in-process` adapter. Core remains sole owner of
data, policy, classification, Context packets, schedules, memory, audit
projection, and Task/Job mutations; it now also owns the loop. There is no
separate deployable, no Ed25519 request token or turn grant, and no Vercel OIDC
allowlist.

A turn is accepted by the control plane and executed in the background of the
same function (`waitUntil`). The loop appends to `soko_bot_runtime_event`, and
the `/sync/soko-bot-turns` drain reads that log and settles the turn exactly as
it did when events came over HTTP. Serverless invocations share no memory, so
the log is a table rather than a buffer.

## Why the separation was dropped

The Eve service existed to keep database authority and ambient user
impersonation out of the agent runtime. That reasoning assumed the agent had a
broad tool surface worth fencing. It did not: every Eve built-in tool
(`bash`, `read_file`, `write_file`, `glob`, `grep`, `web_search`, `web_fetch`,
`todo`, `ask_question`, `agent`) was `disableTool()`, leaving only Sokosumi
capability tools that already executed inside Core. The boundary was a network
hop in front of Core's own service call.

What it cost was concrete and recurring: a Vercel project, a domain, a key pair
and an env set for every network, all of which had to exist and agree before the
feature could serve a single request — and the runtime could drift out of step
with the Core it shares a tool contract with.

The properties that actually gate a tool call are unchanged, because they were
never the deployable's doing: capability scoping, the context snapshot a turn is
pinned to, the memory version it was handed, lease and deadline expiry, and
administrator pause. They are read from the turn row the control plane wrote
instead of from a signed grant that restated it.

## What was given up

- **Durable sessions.** Eve made a turn survivable across a crash. A turn now
  lives inside one Core invocation, bounded by `maxDuration` (300s). A turn that
  outruns it is settled as failed rather than resumed.
- **Compaction.** Sessions were per-turn with bounded rehydrated context, so
  this mattered less than the session limits implied, but a very long
  tool-calling turn now stops at `MAX_STEPS` instead of compacting.
- **Process isolation.** Prompt injection that reaches a tool bug now runs in
  the process holding database credentials. Capability scoping is what stands
  between untrusted text and an authorized action; it is worth more review than
  it was when a network boundary sat behind it.

If durability becomes the binding constraint, the port is still the seam: a
queue- or workflow-backed adapter can replace `in-process` without touching the
control plane.

---

## Superseded: run Soko Bot in a monorepo-owned Eve service with Core as control plane

Soko Bot runs in standalone `apps/soko-bot` on Vercel Eve/Sandbox, while Core
remains sole owner of data, policy, classification, Context packets, schedules,
memory, audit projection, and Task/Job mutations. This remote-but-owned seam
uses a Core `SokoBotRuntime` port with Eve HTTP and in-memory adapters; Core→Eve
request JWTs and turn grants plus Eve→Core project-pinned Vercel OIDC replace
Hermes's broad global service token. Separation preserves independent
durable-runtime scaling and rollback without putting database authority or
ambient user impersonation inside agent runtime.

Each Core turn creates a dedicated Eve session using durable Core turn id as Eve
create `operationId`. Core does not use Eve follow-up messaging because Eve
0.38.3 only deduplicates session creation. Bounded recent conversation, current
Sokosumi Context, and canonical `MEMORY.md` are rehydrated into every session,
preserving continuity while making ambiguous acceptance retries exactly-once.

Turn execution is credit-metered in Core and available only with paid-plan
coverage plus personal credits; bot creation remains available to every
authenticated user. Cutover is a frozen hard cut with no dual writer or reverse
sync: migration preserves user-visible Hermes messages plus step count, never
raw step/reasoning payloads, and validated all-or-nothing command imports
external schedules. External Composio revocation evidence remains required
before decommission.
