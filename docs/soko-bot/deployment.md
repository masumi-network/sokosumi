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
- `FAL_KEY` — generates the mascot pool. Without it the pool stays empty, so
  the avatar picker offers no pictures and the sidebar shows a plain icon
  instead of the bot faces. `/sync/soko-bot-avatars` keeps the pool topped up
  every 30 minutes and is a no-op while the key is unset.
- `AI_GATEWAY_API_KEY` — also routes every turn. Jev (`typesafe-ai/jev`)
  picks the route through the Gateway evaluation API. It has no EU region, so
  this is an owner-approved exception to the EU-only model policy; requests set
  zero data retention and no prompt training. Without the key every turn
  falls back to read-only CLARIFY. Only text a person wrote is classified:
  turns whose prompt Core writes (task-board and delegation events, inbox
  sync, the stand-up and weekly wrap) run on fixed routes in
  `apps/core/src/lib/soko-bot/system-routes.ts`, none of which can hire.
- The agent model is the turn's version model. The default, GPT-6 Luna
  (`openai/gpt-6-luna`), has no EU region on the Gateway either, so it is a
  second owner-approved exception (2026-09-29), for the agent role only:
  owner prompts, Tasks and mail are processed by OpenAI outside the EU, with
  zero data retention and no prompt training. One call is the exception: the
  web search itself, which Perplexity runs through the Gateway, carries only
  the search terms and keeps no prompt training but not zero retention, which
  Perplexity does not offer. The search terms are written by the model and can
  quote the owner's request. EU-pinned versions (v20, on
  Gemini 3.8) stay available, and the lab judge and preview evaluation runs
  stay EU-only. The policy lives in `apps/core/src/lib/soko-bot/model-policy.ts`.

Environment changes only apply to the *next* build, so redeploy after setting
them.

## Move the avatar pool prefix

**Status:** Prisma rewrite `20260904170000_rewrite_soko_bot_avatar_blob_urls`
is in-tree and runs on Core deploy. New puts use `soko-bots/avatars/`. The
copy/delete-legacy steps below are leftover Blob cleanup if objects still
exist under `soko-bot-avatars/` — not a first-run step on every deploy.
Confirm DB URLs and the Blob listing before deleting.

The mascot pool in Vercel Blob is `soko-bots/avatars/{key}-{hash12}.png`.
Older objects used `soko-bot-avatars/`. Chat files stay under
`soko-bots/{uuid}/chats/`.

`GET /v1/soko-bots/avatars` is the picker HTTP API. It is not the Blob folder.
The cron that tops up the pool stays at `/sync/soko-bot-avatars`.

If Blob still has objects under `soko-bot-avatars/`, copy them, then delete
the old prefix after DB URLs are clean:

1. Dry-run, then copy:

   ```sh
   pnpm --filter @sokosumi/core soko-bot:copy-avatars
   pnpm --filter @sokosumi/core soko-bot:copy-avatars -- --copy
   ```

2. If any stored URLs still use the old prefix, Core deploy rewrites them
   (idempotent migration `20260904170000_rewrite_soko_bot_avatar_blob_urls`).
   `sourceUrl` stays the fal origin.

3. After every Core instance writes the new prefix, confirm that
   `soko_bot_avatar.imageUrl` and `soko_bot.avatarImageUrl` contain no
   `/soko-bot-avatars/` strings. Then delete the old prefix:

   ```sh
   pnpm --filter @sokosumi/core soko-bot:copy-avatars -- --delete-legacy --confirm-delete-legacy
   ```

## Runtime shape

- `SOKO_BOT_RUNTIME_ADAPTER` defaults to `sandbox`: each turn runs in a fresh
  Vercel Sandbox VM in `fra1` with web search/fetch, a shell, and the bot's
  workspace mounted from a per-bot Vercel Drive. See
  [ADR 0043](../adr/0043-soko-bot-runs-in-per-bot-sandboxes.md). `in-process`
  runs the loop inside Core without sandbox tools; preview evaluation runs
  always use it. Tests use `in-memory`, which a deployed environment rejects.
- On Vercel, sandboxes are created with the function's OIDC token (the Core
  project needs OIDC enabled). Locally, set `VERCEL_SANDBOX_TOKEN`,
  `VERCEL_SANDBOX_TEAM_ID` and `VERCEL_SANDBOX_PROJECT_ID`, and
  `SOKO_BOT_RUNTIME_PUBLIC_URL` to a URL the sandbox can reach — or run a turn
  with `scripts/soko-bot-runner-local.mts`, which needs neither.
- The sandbox calls Core on `/v1/soko-bot-runtime/turns/{turnId}/…` with a
  per-turn token its network proxy injects. Core serves the prompt, executes
  Sokosumi tools, proxies and meters every model call under the model policy
  (EU pinning, or the owner-approved global agent models above), and
  settles the turn through `soko_bot_runtime_event` and the
  `/sync/soko-bot-turns` drain as before.
- Turns are bounded by the 15-minute turn deadline and `SOKO_BOT_MAX_STEPS`.
- Capability scoping, the pinned context snapshot, lease and deadline checks,
  and administrator pause gate every Sokosumi tool call. After a turn reads the
  web or runs a command, outward actions (hire, job input, integrations,
  uploads, image generation, chat posts) are refused until the owner approves.
- Sandbox tools (web search and fetch, bash, the workspace) are recorded as
  tool-call rows with their clipped output and the pages they give grounds to
  cite. They have no actor bot, so they are never receipts, and they do not
  count toward the per-turn tool limit. A turn's answer keeps only links it
  found or loaded, was given, or that point into Sokosumi.

## History

Until 2026-08-27 the agent ran as a separate Eve app (`apps/soko-bot`) on its
own Vercel project, with Ed25519 request tokens and turn grants between Core and
the runtime, plus a Vercel OIDC allowlist in the other direction. That bought a
process boundary but cost a deployable, a domain, a key pair and an env set per
network. Every Eve built-in tool was disabled, so the boundary was protecting a
loop whose only surface was Core's own capability tools; folding it in removed
the service, the keys and the token plumbing without changing what a turn can
do. See [ADR 0007](../adr/0007-soko-bot-eve-runtime.md).
