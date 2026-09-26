# Project image studio deployment

The image studio has no deployment of its own. It is two halves of existing
deployables:

- **Web** (`apps/web`) — the studio UI, the token route that lets the browser
  talk to the agent, and the eve agent itself. `withEve()` in `next.config.ts`
  builds the agent as a service inside the *same* Vercel project and
  deployment, mounted at `/eve/image-studio/v1/*`. It is not a second Vercel
  project.
- **Core** (`apps/core`) — sessions, jobs, assets, the fal submission, Blob
  storage, and the `/image-studio-agent/*` surface the agent presents its
  grants to.

Both halves ship through the normal pipeline: `/deploy <network>` on a pull
request, or a merge to `main` for production.

## Environment

The studio is off unless every key below is set on the right project. None of
them has a default, and each absence has its own visible symptom.

### Web project (`sokosumi-app-preprod`, `sokosumi-app-mainnet`)

| Key | Why | Absent |
| --- | --- | --- |
| `IMAGE_STUDIO_AGENT_SECRET` | HMAC secret, at least 32 characters. Web signs the short-lived token the browser hands the agent; the agent signs the grant it presents to Core. | `POST /api/projects/:projectId/image-studio/agent-token` answers `503 not_configured`, and the chat replaces its composer with **Studio assistant not available**. |
| a Gateway credential | The agent selects an AI Gateway model id (`anthropic/claude-sonnet-5`), so every model call needs one. **Two routes, and one of them is already on** — see below. | The chat opens and the first turn dies at the first model call. |
| `CORE_APP_BASE_URL` | Core's **origin** for the agent service. The app resolves Core through `@vercel/related-projects`, but that runs inside Next; the agent is a separate service and reads this variable directly. | The agent throws `CORE_APP_BASE_URL is not configured`, every authorization returns false, and the channel answers `401`. |

`CORE_APP_BASE_URL` is the origin, with no `/v1`. Do not copy
`NEXT_PUBLIC_CORE_APP_BASE_URL` into it by hand: Next builds that value with
`/v1` already appended and it is client-exposed. (A `/v1` suffix is stripped
defensively, but the variable to set is the origin.)

#### The Gateway credential: OIDC first

The Gateway accepts either a Vercel project OIDC token or an explicit
`AI_GATEWAY_API_KEY`, and OIDC needs no variable set. Both preprod projects have
it on — `oidcTokenConfig` is `{"enabled": true, "issuerMode": "team"}` on
`sokosumi-app-preprod` and `sokosumi-core-preprod` (`GET /v9/projects/<id>`,
checked 2026-09-25) — so their deployments are issued a `VERCEL_OIDC_TOKEN`, and
the agent's build output bundles `@vercel/oidc`, which is what reads and
refreshes it.

So **plan on setting no model credential at all**, and treat
`AI_GATEWAY_API_KEY` as the fallback for when a turn fails on credentials
rather than on anything else. What OIDC being enabled does not prove is that a
turn succeeds: that takes one real turn, which costs money. Confirm
`oidcTokenConfig.enabled` is still true before relying on this.

### Core project (`sokosumi-core-preprod`, `sokosumi-core-mainnet`)

| Key | Why | Absent |
| --- | --- | --- |
| `IMAGE_STUDIO_AGENT_SECRET` | **The same value as the Web project.** Core verifies the agent's grants with it and re-checks the named user's project access on every call. | Core rejects every agent call; the conversation opens and nothing it tries succeeds. |
| `FAL_KEY` | Submits the generation. | `FAL_KEY is not configured` on the first generate. |
| `BLOB_READ_WRITE_TOKEN` | Stores the image that comes back. | The job completes at fal and then fails to settle. |

Core carries `FAL_KEY` and `BLOB_READ_WRITE_TOKEN` for Soko Bot and the rest of
the platform, so in practice `IMAGE_STUDIO_AGENT_SECRET` is the only one it is
missing — but read the project rather than trusting that sentence:
`vercel env ls preview --cwd apps/core` lists names and targets without
revealing any value.

**The store behind that token is a public one, and the studio writes to it as
such.** `BLOB_READ_WRITE_TOKEN` on both networks names the single shared store
(`sokosumi-preprod-blob`, `sokosumi-mainnet-blob`) that project files,
DESIGN.md, avatars and user uploads already write to with `access: "public"`.
Vercel decides public or private per *store*, not per object, and a private
`put` against a public store is refused outright — so the studio uses `public`
too. What keeps a version from being readable by anyone is not the store: it is
that the only way the product hands the bytes out is
`GET /api/projects/:projectId/image-studio/assets/:assetId/content`, which
re-checks project access on every request, and that the pathname carries a
content hash rather than being enumerable. If a network is ever given a
dedicated private store for the studio, the `access` in
`image-studio-jobs.service.ts` and `image-studio-assets.service.ts` has to move
with it; they must always agree with each other and with the store.

No credential belongs in a `NEXT_PUBLIC_*` variable. The browser never sees the
Gateway key or either HMAC secret — it only ever holds the five-minute token
the Web route mints for it.

## Setting it up for a branch preview

Preview variables can be scoped to one Git branch, which is how a feature
branch gets a working studio without touching what every other preview on the
network sees. `vercel env add <name> <environment> <gitbranch>`.

Generate the shared secret **once** and give both projects the identical value.
Keep it in a file rather than on a command line, so it never reaches shell
history or a log:

```sh
umask 077
openssl rand -base64 48 | tr -d '\n' > /tmp/image-studio-agent-secret
```

Then, with `BRANCH` set to the branch the preview was built from:

```sh
BRANCH=codepat/project-image-studio-01a0d5d6

vercel link --project sokosumi-app-preprod --team masumi --yes --cwd apps/web
vercel env add IMAGE_STUDIO_AGENT_SECRET preview "$BRANCH" --cwd apps/web --force --yes \
  < /tmp/image-studio-agent-secret

vercel link --project sokosumi-core-preprod --team masumi --yes --cwd apps/core
vercel env add IMAGE_STUDIO_AGENT_SECRET preview "$BRANCH" --cwd apps/core --force --yes \
  < /tmp/image-studio-agent-secret

shred -u /tmp/image-studio-agent-secret
```

`vercel link` also writes `apps/<app>/.env.local` with a fresh
`VERCEL_OIDC_TOKEN` in it. That is a credential on disk. Both `.env*` and
`.vercel/` are gitignored, so nothing can be committed by accident, but delete
them when you are done rather than leaving them in the worktree.

That is the whole of the secret work, because OIDC covers the model credential.

**Only if a turn fails on credentials** does `AI_GATEWAY_API_KEY` come into it,
and then someone has to supply the value: it cannot be sourced from Core, where
`vercel env ls` shows it as type `Secret` and Vercel will not hand a sensitive
value back. It has to come from the team's own secret store or a key minted in
the AI Gateway dashboard. Never echo it:

```sh
vercel env add AI_GATEWAY_API_KEY preview "$BRANCH" --cwd apps/web --force --yes \
  < /path/to/gateway-key
```

Core's origin for that branch follows the branch alias:

```sh
printf 'https://sokosumi-core-preprod-git-%s.preview.sokosumi.com' \
  "$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\+/-/g; s/-$//')" \
  | vercel env add CORE_APP_BASE_URL preview "$BRANCH" --cwd apps/web --force --yes
```

That host is the same one `resolveCoreRelatedProjectFallbackHost()` derives, so
the agent and the app agree on which Core they are talking to. It is not a
secret. The Web project already holds a `CORE_APP_BASE_URL`, but on the
**Production** target only, so Preview has to be given its own.

Preview variables are applied at build time, so **redeploy after setting them**
(`/deploy preprod` on the pull request). Remove the branch-scoped variables
when the branch is done; they outlive the branch otherwise.

For production, the same keys go on the Preview-wide or Production scope of
`sokosumi-app-mainnet` and `sokosumi-core-mainnet`, with a secret generated for
that network — never the preprod one. Two things there are unchecked and must be
read before anyone plans that rollout: whether the mainnet projects have
`oidcTokenConfig.enabled`, and that `sokosumi-app-preprod` has no
`IMAGE_STUDIO_AGENT_SECRET` on **any** target, Production included — so
production Web is missing it too, not only this preview.

## Verifying

Ordered so that each step adds one thing, not so that the cheap steps come
first — only step 1 is free.

1. `POST /api/projects/:projectId/image-studio/agent-token` returns a token
   rather than `503 not_configured`. That covers the Web secret alone, and
   spends nothing.
2. Open the studio on a project and send a message. A `401` from
   `/eve/image-studio/v1/*` means the two halves disagree about the secret, or
   the agent cannot reach Core; a credential error from the Gateway instead
   means OIDC did not carry, and that is when `AI_GATEWAY_API_KEY` is worth
   adding. **This step already costs money**: the turn is a billed Gateway
   call, priced per token, before any image exists.
3. Generate one image. This adds the fal charge and is the first call that needs
   `FAL_KEY` and `BLOB_READ_WRITE_TOKEN` as well. Watch it *settle*, not just
   start: a version has to appear. A tile that stays **Generating** for minutes
   after fal is done means settlement is failing, and the job row carries the
   reason in `lastPollError` with `unreachableSource = result`.

## Deploy side effects

- **Migrations.** Core's `vercel-build` ends in `prisma:migrate:deploy`, so
  every Core deploy — *including a preview* — writes schema to whatever
  database that deployment's `DATABASE_URL` resolves to. The studio added six
  migrations: `20260925001732_project_image_studio`,
  `20260925014414_image_job_cancel_request_and_poll_failures`,
  `20260925032529_image_studio_settle_lease_and_outage`,
  `20260925043309_image_studio_per_dependency_outages`,
  `20260925120000_image_studio_initial_turn_state` and
  `20260925130000_image_studio_initial_turn_lease_owner`. They are additive:
  new tables, columns and enum values for the studio's own rows.

  What a build log does and does not tell you: a successful
  `prisma migrate deploy` proves that *those* migrations ran against *that*
  connection at *that* time. It does not identify the database — Prisma prints
  the host redacted — and it does not tell you what is pending now. Before
  relying on either, check `DATABASE_URL`'s scope on the Core project and the
  `_prisma_migrations` table of the database the next deploy will actually
  reach. Treat an unverified "it is the shared database" and an unverified
  "nothing is pending" as equally unknown.
- **Crons.** `/sync/image-jobs` is registered in `apps/core/vercel.json` and
  runs on production deployments only. Previews settle instead by
  reconciliation: reading a project's studio state or asking the agent to check
  a generation polls fal for that project's open jobs.
- **Webhook.** Core registers a fal callback at its own public origin
  (`/webhooks/fal/image-jobs`) whenever that origin is `https` and not
  localhost. Registering it is not the same as fal being able to deliver it:
  deployment protection on the Core project will answer fal's POST instead of
  Core, and the route independently rejects anything it cannot verify against
  fal's JWKS. So `https` alone establishes nothing — check the project's
  protection setting if you are counting on the callback. Nothing needs
  configuring either way, because reconciliation settles the job when the
  callback does not arrive.
- **Web build.** `withEve()` adds the agent service to the Web build. It builds
  through `node ../../node_modules/eve/bin/eve.js build --skip-sandbox-prewarm`
  and needs no sandbox provider, because the agent runs with
  `defaultTools: false`.
