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
| `AI_GATEWAY_API_KEY` | The agent selects an AI Gateway model id (`anthropic/claude-sonnet-5`), so this is the credential behind every model call it makes. | The chat opens and the first turn dies at the first model call. |
| `CORE_APP_BASE_URL` | Core's **origin** for the agent service. The app resolves Core through `@vercel/related-projects`, but that runs inside Next; the agent is a separate service and reads this variable directly. | The agent throws `CORE_APP_BASE_URL is not configured`, every authorization returns false, and the channel answers `401`. |

`CORE_APP_BASE_URL` is the origin, with no `/v1`. Do not copy
`NEXT_PUBLIC_CORE_APP_BASE_URL` into it by hand: Next builds that value with
`/v1` already appended and it is client-exposed. (A `/v1` suffix is stripped
defensively, but the variable to set is the origin.)

### Core project (`sokosumi-core-preprod`, `sokosumi-core-mainnet`)

| Key | Why | Absent |
| --- | --- | --- |
| `IMAGE_STUDIO_AGENT_SECRET` | **The same value as the Web project.** Core verifies the agent's grants with it and re-checks the named user's project access on every call. | Core rejects every agent call; the conversation opens and nothing it tries succeeds. |
| `FAL_KEY` | Submits the generation. | `FAL_KEY is not configured` on the first generate. |
| `BLOB_READ_WRITE_TOKEN` | Stores the image that comes back. | The job completes at fal and then fails to settle. |

Core already carries `FAL_KEY` and `BLOB_READ_WRITE_TOKEN` for Soko Bot and
the rest of the platform; `IMAGE_STUDIO_AGENT_SECRET` is the one it is missing.

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

vercel link --project sokosumi-app-preprod --scope masumi --cwd apps/web
vercel env add IMAGE_STUDIO_AGENT_SECRET preview "$BRANCH" --cwd apps/web --force --yes \
  < /tmp/image-studio-agent-secret

vercel link --project sokosumi-core-preprod --scope masumi --cwd apps/core
vercel env add IMAGE_STUDIO_AGENT_SECRET preview "$BRANCH" --cwd apps/core --force --yes \
  < /tmp/image-studio-agent-secret

shred -u /tmp/image-studio-agent-secret
```

The Gateway key is an existing, already authorized credential — take it from
the team's secret store or from `sokosumi-core-preprod`, which has been calling
the Gateway for Soko Bot and project memory. Never echo it:

```sh
vercel env add AI_GATEWAY_API_KEY preview "$BRANCH" --cwd apps/web --force --yes \
  < /path/to/gateway-key
```

And Core's origin for that branch, which follows the branch alias:

```sh
printf 'https://sokosumi-core-preprod-git-%s.preview.sokosumi.com' \
  "$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\+/-/g; s/-$//')" \
  | vercel env add CORE_APP_BASE_URL preview "$BRANCH" --cwd apps/web --force --yes
```

That host is the same one `resolveCoreRelatedProjectFallbackHost()` derives, so
the agent and the app agree on which Core they are talking to. It is not a
secret.

Preview variables are applied at build time, so **redeploy after setting them**
(`/deploy preprod` on the pull request). Remove the branch-scoped variables
when the branch is done; they outlive the branch otherwise.

For production, set the same keys on the Preview-wide or Production scope of
`sokosumi-app-mainnet` and `sokosumi-core-mainnet`, with a secret generated for
that network — never the preprod one.

## Verifying

1. `POST /api/projects/:projectId/image-studio/agent-token` returns a token
   rather than `503 not_configured`. That covers the Web secret alone.
2. Open the studio on a project and send a message. A `401` from
   `/eve/image-studio/v1/*` means the two halves disagree about the secret, or
   the agent cannot reach Core.
3. Generate one image. That is the first call that needs `FAL_KEY`,
   `BLOB_READ_WRITE_TOKEN` and the Gateway key together, and it costs money —
   so it is the last step, not the first.

## Deploy side effects

- **Migrations.** Core's `vercel-build` ends in `prisma:migrate:deploy`, so a
  Core deploy — *including a preview* — migrates that network's shared
  database. The studio added six migrations:
  `20260925001732_project_image_studio`,
  `20260925014414_image_job_cancel_request_and_poll_failures`,
  `20260925032529_image_studio_settle_lease_and_outage`,
  `20260925043309_image_studio_per_dependency_outages`,
  `20260925120000_image_studio_initial_turn_state` and
  `20260925130000_image_studio_initial_turn_lease_owner`. They are additive —
  new tables, columns and enum values for the studio's own rows — and a Core
  preview on this branch has already applied them to preprod, so redeploying
  the same revision migrates nothing further.
- **Crons.** `/sync/image-jobs` is registered in `apps/core/vercel.json` and
  runs on production deployments only. Previews settle instead by
  reconciliation: reading a project's studio state or asking the agent to check
  a generation polls fal for that project's open jobs.
- **Webhook.** Core registers a fal callback at its own public origin
  (`/webhooks/fal/image-jobs`) whenever that origin is a reachable `https`
  host, which a branch preview is. Nothing to configure; if the callback never
  arrives, reconciliation still settles the job.
- **Web build.** `withEve()` adds the agent service to the Web build. It builds
  through `node ../../node_modules/eve/bin/eve.js build --skip-sandbox-prewarm`
  and needs no sandbox provider, because the agent runs with
  `defaultTools: false`.
