# Buzz chat: production

Every organization's chat is also on [Buzz](https://github.com/block/buzz-app)
(Nostr, NIP-29), so people use Sokosumi or the Buzz app in the same rooms.
Sokosumi's database stays the source of truth. Local setup and the bridge's
design: [scripts/buzz-local/README.md](../../scripts/buzz-local/README.md).

```text
Buzz app ──wss──▶ relay (Railway)  ◀── operator API, events ── Core /sync/buzz (Vercel cron)
                   │ Postgres ◀──────── history import, join check ──┘      │
                   │ Redis, S3                                              ▼
                                                              Sokosumi DB (Neon)
```

- **Communities**: one per organization, `wss://{label}.chat.sokosumi.com`,
  created by Core through the relay's operator API. The label is the slug, or
  a DNS-safe form of it plus part of the organization id.
- **Bridge**: `GET /sync/buzz` (cron, every minute) runs the bridge for 270 s
  under a 90 s lease renewed every 15 s (a run stops once a renewal is 45 s overdue), so one run is active and the next
  takes over within about a second. Inbound events missed in between are
  caught up from each community's saved cursor.
- **History**: when a room first reaches Buzz, its earlier messages are
  written into the relay's Postgres (the relay refuses events more than
  15 minutes old), signed by their authors at their original time, read.

## Relay on Railway

One service from the image, plus Railway Postgres and Redis and an S3 bucket
(Railway bucket or Cloudflare R2). Pin the image Core was tested against:

```text
ghcr.io/block/buzz@sha256:1d2f40fa5c951d752587b0bd97bd2736d10175e5e61d35201824aa4044e7d3ea
```

The history import writes the relay's tables directly, so upgrading the image
means running `pnpm --filter @sokosumi/core buzz:e2e` against a staging relay
on the new image first.

Domains: `chat.sokosumi.com` and the wildcard `*.chat.sokosumi.com` on the
relay service (Railway issues the wildcard certificate after the
`_acme-challenge` CNAME). The relay picks the community from the `Host`
header, which Railway passes through unchanged.

| Variable                                                                            | Value                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RELAY_URL`                                                                         | `wss://chat.sokosumi.com` (wss: the relay derives https for every community from it)                                                                      |
| `BUZZ_DOMAIN`                                                                       | `chat.sokosumi.com`                                                                                                                                       |
| `RELAY_OPERATOR_API_ORIGIN`                                                         | `https://operator.chat.sokosumi.com`                                                                                                                      |
| `RELAY_OPERATOR_PUBKEYS`, `RELAY_OWNER_PUBKEY`                                      | the operator's public key (hex)                                                                                                                           |
| `BUZZ_RELAY_PRIVATE_KEY`                                                            | a new key, the relay's own (hex)                                                                                                                          |
| `BUZZ_REQUIRE_RELAY_MEMBERSHIP`                                                     | `true`                                                                                                                                                    |
| `BUZZ_ALLOW_NIP_OA_AUTH`                                                            | `true` (personal agents, linked app keys)                                                                                                                 |
| `BUZZ_REQUIRE_AUTH_TOKEN`                                                           | `false`                                                                                                                                                   |
| `BUZZ_AUTO_MIGRATE`                                                                 | `true`                                                                                                                                                    |
| `BUZZ_PUSH_ENABLED`                                                                 | `false` until push is set up                                                                                                                              |
| `BUZZ_RATE_LIMIT_HUMAN_API_CALLS_PER_MIN`, `BUZZ_RATE_LIMIT_HUMAN_MESSAGES_PER_MIN` | `6000` each: the operator key signs every community's channel and membership changes, and the defaults (300 and 60 per key) would throttle the first sync |
| `DATABASE_URL`, `REDIS_URL`                                                         | Railway's                                                                                                                                                 |
| `BUZZ_S3_ENDPOINT`, `BUZZ_S3_BUCKET`, `BUZZ_S3_ACCESS_KEY`, `BUZZ_S3_SECRET_KEY`    | the bucket                                                                                                                                                |
| `BUZZ_MEDIA_SERVER_DOMAIN`                                                          | `chat.sokosumi.com`; the relay serves each community's files on that community's own host, which is where the bridge copies them from                     |
| `BUZZ_GIT_HOOK_HMAC_SECRET`                                                         | 32 random bytes (hex)                                                                                                                                     |
| `BUZZ_BIND_ADDR`, `BUZZ_HEALTH_PORT`                                                | `0.0.0.0:$PORT`, `8080` (health: `/_readiness`)                                                                                                           |

Generate the operator key once (`node -e` with `nostr-tools`, or
`buzz-admin generate-key`) and keep its secret only in Vercel.

## Core on Vercel

| Variable                      | Value                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `BUZZ_COMMUNITY_URL_TEMPLATE` | `wss://{slug}.chat.sokosumi.com`                                                                             |
| `BUZZ_OPERATOR_SECRET_KEY`    | the operator's secret key (hex)                                                                              |
| `BUZZ_KEY_ENCRYPTION_SECRET`  | 32+ random characters; encrypts people's Nostr keys and bridge API keys. Never rotate without re-encrypting. |
| `BUZZ_OPERATOR_API_ORIGIN`    | `https://operator.chat.sokosumi.com`                                                                         |
| `BUZZ_RELAY_DATABASE_URL`     | the relay's Postgres, public URL with TLS                                                                    |

The `/sync/buzz` cron is in `apps/core/vercel.json`; the function's 300 s limit
is why a run lasts 240 s (the rest lets the change being applied finish).

## Rollout

1. Deploy the relay; check `https://chat.sokosumi.com/_readiness` and that
   `https://operator.chat.sokosumi.com/operator/communities` answers 401
   (unsigned) rather than 404.
2. Set the Vercel variables and deploy Core (the migration
   `20261115100000_buzz_production` runs with it).
3. The first runs give every organization a community (25 created per
   30-second sweep: about half an hour for 1,300), put each room on Buzz
   (50 per sweep) and import its history (3 rooms per sweep). Watch the
   `[sync/buzz]` log lines.
4. `pnpm --filter @sokosumi/core buzz:bridge status` (with production env)
   lists communities, channels and the outbox.

**Long outages**: a run catches up from each community's saved position in
one go before it applies anything. At today's volume (about 10,000 messages a
month across all organizations) even a month away downloads in seconds; an
outage with far more traffic than a 240 s run can download would need the
catch-up made resumable first.

**Connections**: the bridge keeps one live relay connection per community
with rooms, and one per person reading Directs there (Directs share readers
where they can). Today that is about 430; one function holds about a
thousand, and the bridge logs a warning past 800.

**Rollback**: remove `BUZZ_COMMUNITY_URL_TEMPLATE` from Vercel and redeploy.
The bridge stops; Sokosumi chat is unaffected. Nothing in Sokosumi's data
depends on Buzz.

## Checks

`pnpm --filter @sokosumi/core buzz:e2e [--soak]` runs the end-to-end checks
against a running Core, relay and bridge: both directions for messages, edits,
reactions, threads and deletions, a message from a person's own Buzz app, a
deleted Direct, and (`--soak`) five minutes of traffic across lease
hand-overs, every message arriving exactly once.
