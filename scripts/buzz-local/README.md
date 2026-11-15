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
  (AES-GCM at rest). The recommended way in is **Connections → Buzz → Use Buzz
  as you**: save the key file; on Buzz's first screen choose _Other options_,
  enter the community address, then _Use an existing key_ and drop in the file
  (Buzz 1.0 leads with Builderlab email sign-in; a key is the other way in).
  The Buzz app then signs in as the same identity, already a community member,
  so no invite. Someone who keeps their own Buzz identity can
  link it instead (paste its `npub`, open a single-use invite); their Buzz
  messages count as them here, but their Buzz agents answer only their Buzz app.
- **Personal agents via Buzz**: agents created in the Buzz app (Claude Code,
  goose, Codex…) carry an owner signature (NIP-OA). The bridge finds those owned
  by your Sokosumi key or a linked app key (kind 30177 records, checked against
  each agent's signed profile) and makes each a Coworker named "… (personal
  agent)", captioned "Personal agent via Buzz · owner". Only its owner can add it
  to a room, and only one they are in, from Sokosumi or by inviting it to the
  channel in Buzz (mirrored both ways); it leaves a room when its owner does.
  An organization's owners and admins decide under Connections → Buzz whether
  members may bring their own agents (on by default); off, a personal agent
  needs approval first and those granted by the switch leave. Buzz desktop
  agents answer only their owner (they run as them), which is why you use Buzz
  as you; a reply comes back as the Coworker. Anyone else who mentions one is
  told so: the agent replies in Sokosumi ("I only take requests from …"), and Sokosumi posts
  the same in the Buzz thread.
- **Coworkers and Soko Bots** each speak on Buzz with their own key. A
  mention from Buzz runs Sokosumi's usual dispatch, and a message from Buzz in
  a one-on-one Coworker Direct goes through the room's stream, as Sokosumi's
  own clients do; the answer reaches Buzz when it is complete.
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

One relay (Railway) serves every organization, a community per host; Core
creates them, runs the bridge from its `/sync/buzz` cron and imports history.
See [docs/features/buzz-chat.md](../../docs/features/buzz-chat.md).

Locally, `setup.mjs` configures the same: an operator API on
`operator.localhost:3400` and communities on `{slug}.localhost:3400`. The relay
derives every community's scheme from `RELAY_URL`, so with a `wss://` one
(Tailscale) the `ws://*.localhost` communities refuse signed HTTP calls; give
such a community a second `tailscale serve` port instead, as the e2e setup does.

## Known limits

- History is imported into the relay's database when a room reaches Buzz
  (the relay refuses events more than 15 minutes old through its API).
- Files: Sokosumi's chat files are public links Buzz shows as they are. A file
  attached in Buzz (on the relay, readable only by members) is copied into the
  author's Sokosumi chat files and the message points there.
- Pins, read state, quotes, result cards and attached skills are Sokosumi-only;
  Buzz shows the message text.
- Messages from people Sokosumi does not know are ignored; only Sokosumi
  identities are community members.
- A person's bridge API key appears in their API keys as "Buzz bridge"; it is a
  full user key.
- A linked app key: what it writes is the person's in Sokosumi, but what they
  write in Sokosumi reaches Buzz from Sokosumi's key, named "<name> (via
  Sokosumi)", since Sokosumi never holds their own key. Sokosumi cannot edit or
  delete on Buzz what the app key wrote. Directs opened before the link stay
  without the app key (a Buzz DM's people are fixed).
- A Buzz agent's reactions stay on Buzz: Sokosumi keeps reactions to people. Its
  messages, edits and deletions reach Sokosumi.
- Linking proves the key joined with an invite issued after the request, not
  which invite: someone could paste another person's `npub` and forward them
  the invite, and their Buzz messages would then count as the requester's. Two
  requests for one key link neither. The fix is a signature from the key bound
  to the account, such as Buzz's owner attestation (Settings → Security →
  Authorize external identity) for Sokosumi's key.
