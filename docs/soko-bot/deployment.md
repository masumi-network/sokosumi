# Soko Bot deployment

Soko Bot has no deployment of its own. The agent loop runs inside `apps/core`,
so it ships with Core and is deployed by the same pipeline: `/deploy <network>`
on a pull request, or a merge to `main` for production.

## Enabling it

Every `/v1/soko-bots/*` route returns 404 while `SOKO_BOT_ENABLED` is false,
which is the default. That flag is the launch switch.

On the Core project for the network (`sokosumi-core-preprod` or
`sokosumi-core-mainnet`):

```
vercel env add SOKO_BOT_ENABLED preview --value true --project sokosumi-core-preprod --force --yes
```

Nothing else is required. Model calls go through the AI Gateway using
`AI_GATEWAY_API_KEY`, which Core already has.

Optional, per network:

- `SOKO_BOT_PROACTIVE_PAUSED=true` — platform-wide kill switch for everything
  bots start on their own (stand-ups, ingest, nudges). Worth setting before the
  first run on a network so proactive turns cannot fire against live accounts
  until someone has watched a turn end to end.
- `COMPOSIO_API_KEY` — brokers OAuth for Gmail, Outlook and Calendar
  integrations. Without it, integrations are unavailable and the rest of the
  bot still works.
- `SOKO_BOT_CLASSIFIER_MODE=model` — route classification by model instead of
  the deterministic default.

Environment changes only apply to the *next* build, so redeploy after setting
them.

## Runtime shape

- `SOKO_BOT_RUNTIME_ADAPTER` is `in-process` everywhere except tests, which use
  `in-memory`. A deployed environment with Soko Bot enabled rejects any other
  value at env-validation time, so a misconfigured deploy fails to boot rather
  than silently running a stub.
- A turn is accepted by the control plane and executed in the background of the
  same Core function (`waitUntil`). The loop appends to `soko_bot_runtime_event`
  as it goes, and the existing `/sync/soko-bot-turns` cron drains that log and
  settles the turn — unchanged from when the runtime was a separate service.
- Turns are bounded by Core's function `maxDuration` (300s, set in
  `apps/core/vercel.json`) and by `MAX_STEPS` in the runtime.
- Tools execute in-process against `sokoBotRuntimeService`. Capability scoping,
  the pinned context snapshot, lease and deadline checks, and administrator
  pause all still gate every call — they read the turn row rather than a signed
  grant.

## History

Until 2026-08-27 the agent ran as a separate Eve app (`apps/soko-bot`) on its
own Vercel project, with Ed25519 request tokens and turn grants between Core and
the runtime, plus a Vercel OIDC allowlist in the other direction. That bought a
process boundary but cost a deployable, a domain, a key pair and an env set per
network. Every Eve built-in tool was disabled, so the boundary was protecting a
loop whose only surface was Core's own capability tools; folding it in removed
the service, the keys and the token plumbing without changing what a turn can
do. See [ADR 0007](../adr/0007-soko-bot-eve-runtime.md).
