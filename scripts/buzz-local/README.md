# Buzz bridge, locally

Sokosumi chat on [Buzz](https://github.com/block/buzz-app) (Nostr, NIP-29): every
room of an organization on Buzz is also a Buzz channel, so its people chat from
Sokosumi or from the Buzz app, in the same rooms.

```text
Sokosumi Web ─┐                              ┌─ Buzz app (signs in with the
              │                              │   person's exported key)
            Core ── outbox ── bridge worker ── buzz-relay (one per deployment,
              ▲                     │           one community per host)
              └── Core chat routes ─┘  inbound: replayed as the author
```

- **Out**: every chat change already passes `publishChatRoomMessageRealtime`, which now
  also writes a `buzz_outbox` row. The worker reconciles each quiet message (2 s,
  so a streaming bot reply goes out once) with the relay: kind 9, then 40003
  edits, 5 deletes, 7 reactions, each signed by its author's key.
- **In**: the worker subscribes to every linked channel and replays Buzz events
  through Core's own chat routes with the author's bridge API key, so a Buzz
  message gets mentions, Soko Bot replies and notifications like a typed one.
- **Echo**: links (`buzz_message_link`, `buzz_reaction_link`) are written before
  an event is sent, and a Buzz post carries `clientMessageId: buzz:<event id>`.
- **Nothing lost**: each signed event stays on its link (`pendingEvent`) until
  the relay accepts it (re-signed if an outage made it too old); outbox rows
  retry with backoff and are never dropped; inbound events retry while Core is
  down, wait for the message they refer to, and catch up oldest-first from a
  saved cursor (paged) after the worker was away. Edits settle newest-wins,
  ties to the lower event id.
- **Identity**: Sokosumi keeps one Nostr key per person, Soko Bot and Coworker
  (AES-GCM at rest). People export theirs on **Connections → Buzz** to sign in
  to the Buzz app as the same identity.
- **Rooms**: a Channel is a private Buzz channel whose members follow the room;
  a Direct of up to nine people is a Buzz DM (kind 41010) in a community all its
  people share.

## Run it

```bash
# 1. Relay + an isolated Sokosumi Postgres (pgvector), keys generated once.
cd apps/core && node ../../scripts/buzz-local/setup.mjs
cd ../../scripts/buzz-local && docker compose --env-file .env up -d

# 2. Point Core at them (apps/core/.env): DATABASE_URL to the local DB, plus
#    BUZZ_COMMUNITY_URL_TEMPLATE=ws://localhost:3400
#    BUZZ_OPERATOR_SECRET_KEY=<SOKOSUMI_BUZZ_OPERATOR_SECRET_KEY from .env>
#    BUZZ_KEY_ENCRYPTION_SECRET=<32+ random characters>
#    then migrate and seed: pnpm --filter @sokosumi/database exec prisma migrate deploy
#    CLOUD_AGENT_DB_FORCE=1 node scripts/agent-db/seed-auth-fixtures.mjs

# 3. Core, Web, and the bridge worker.
pnpm --filter @sokosumi/core dev
pnpm --filter web dev
pnpm --filter @sokosumi/core buzz:bridge run --core-url http://localhost:3001

# 4. Put an organization on Buzz: Connections → Buzz → "Put chats on Buzz"
#    (owners and admins), or:
pnpm --filter @sokosumi/core buzz:bridge enable --org alice-fixture
```

To chat from the Buzz app: install Buzz 1.0, add the address shown under
Connections → Buzz (`ws://localhost:3400` locally), and import your secret key.

## Production shape

One relay deployment serves every organization: a community per host
(`BUZZ_COMMUNITY_URL_TEMPLATE=wss://{slug}.chat.sokosumi.com`), shared Postgres
with a `community_id` and row-level security. Creating a community on a
multi-community relay (`POST /operator/communities`) is not wired here: the
local relay has one community. The worker must run somewhere long-lived
(Railway), not on Vercel.

## Known limits

- History before a room is linked stays in Sokosumi: the relay refuses events
  more than a few minutes old, so a backfill needs a relay-side import.
- Files travel as the links in the message text; no Blossom upload or `imeta`.
- Pins, read state, quotes, result cards and attached skills are Sokosumi-only;
  Buzz shows the message text.
- Messages from people Sokosumi does not know are ignored; only Sokosumi
  identities are community members.
- A person's bridge API key appears in their API keys as "Buzz bridge"; it is a
  full user key.
- A message from Buzz into a one-on-one Direct with a Coworker is stored but
  does not start the Coworker's reply: Sokosumi clients reach that reply
  through the room's `/stream` endpoint, which the bridge does not call yet.
- Run one worker; two would each send their own copy of an inbound change.
