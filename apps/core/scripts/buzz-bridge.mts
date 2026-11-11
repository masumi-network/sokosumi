/**
 * Buzz bridge worker: keeps organizations' chats and their Buzz communities in
 * step, in both directions. Long-running, so it lives outside the serverless
 * Core; it needs Core's database and a running Core to post through.
 *
 *   pnpm --filter @sokosumi/core buzz:bridge enable --org <id or slug>
 *   pnpm --filter @sokosumi/core buzz:bridge run [--core-url http://localhost:3001]
 *   pnpm --filter @sokosumi/core buzz:bridge status
 */
import type { Event } from "nostr-tools/pure";
import { getEnv } from "@/config/env";
import { INBOUND_KINDS } from "@/lib/buzz/events";
import { type RelaySubscription, subscribe } from "@/lib/buzz/relay-client";
import prisma from "@/lib/db/prisma";
import {
  applyInboundEvent,
  buzzConfig,
  buzzSubscriptions,
  type CoreRequest,
  drainBuzzOutbox,
  enableBuzzForOrganization,
  linkedBuzzRooms,
  syncRoomChannel,
  unlinkedBuzzRooms,
} from "@/services/buzz-bridge.service";

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

function log(message: string, extra?: unknown) {
  const line = `[buzz-bridge ${new Date().toISOString()}] ${message}`;
  if (extra === undefined) console.log(line);
  else console.log(line, extra);
}

async function enable() {
  const org = flag("org");
  if (!org) throw new Error("--org <id or slug> is required");
  const organization = await prisma.organization.findFirstOrThrow({
    where: { OR: [{ id: org }, { slug: org }] },
    select: { id: true, name: true },
  });
  const community = await enableBuzzForOrganization(organization.id);
  log(`${organization.name} is on Buzz at ${community.relayUrl}`);
}

async function status() {
  const communities = await prisma.buzzCommunity.findMany({
    select: {
      relayUrl: true,
      organization: { select: { name: true } },
      _count: { select: { channels: true, members: true } },
    },
  });
  const [messages, reactions, outbox] = await Promise.all([
    prisma.buzzMessageLink.count(),
    prisma.buzzReactionLink.count(),
    prisma.buzzOutbox.count(),
  ]);
  console.table(
    communities.map((c) => ({
      organization: c.organization.name,
      relay: c.relayUrl,
      channels: c._count.channels,
      members: c._count.members,
    })),
  );
  log(`${messages} messages, ${reactions} reactions linked; outbox ${outbox}`);
}

function coreRequester(baseUrl: string): CoreRequest {
  return async ({ method, path, apiKey, body }) => {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // keep text
    }
    return { status: response.status, body: parsed };
  };
}

async function run() {
  const maybeConfig = buzzConfig();
  if (!maybeConfig) {
    throw new Error(
      "Set BUZZ_COMMUNITY_URL_TEMPLATE, BUZZ_OPERATOR_SECRET_KEY and BUZZ_KEY_ENCRYPTION_SECRET",
    );
  }
  const config = maybeConfig;
  const core = coreRequester(
    flag("core-url") ?? `http://localhost:${getEnv().PORT}`,
  );
  log(`running as operator ${config.operatorPubkey.slice(0, 8)}…`);

  // One subscription per community, reopened when its channel set changes.
  const live = new Map<
    string,
    { key: string; subscription: RelaySubscription }
  >();
  // Inbound events are applied one at a time, in arrival order. One that
  // fails (Core down, rate limited) is retried with backoff; `seen` holds only
  // events that are done or queued.
  let inbound = Promise.resolve();
  const seen = new Set<string>();
  const MAX_ATTEMPTS = 6;

  const apply = (event: Event, attempt: number) => {
    inbound = inbound.then(async () => {
      try {
        const result = await applyInboundEvent(event, core);
        if (result !== "echo" && result !== "ignored") {
          log(`in  kind ${event.kind} ${event.id.slice(0, 8)} → ${result}`);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (attempt + 1 >= MAX_ATTEMPTS) {
          log(`in  kind ${event.kind} ${event.id.slice(0, 8)} gave up`, reason);
          return;
        }
        const delay = 2_000 * 2 ** attempt;
        log(
          `in  kind ${event.kind} ${event.id.slice(0, 8)} failed, retry in ${delay / 1000}s`,
          reason,
        );
        setTimeout(() => apply(event, attempt + 1), delay);
      }
    });
  };

  const onEvent = (event: Event) => {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 50_000) seen.clear();
    apply(event, 0);
  };

  async function refreshSubscriptions() {
    for (const community of await buzzSubscriptions()) {
      const key = community.channelIds.toSorted().join(",");
      const current = live.get(community.communityId);
      if (current?.key === key) continue;
      current?.subscription.close();
      live.delete(community.communityId);
      if (community.channelIds.length === 0) continue;
      const subscription = subscribe({
        relayUrl: community.relayUrl,
        secretKey: config.operatorSecretKey,
        filters: [
          {
            kinds: INBOUND_KINDS,
            "#h": community.channelIds,
            // Catch up on what happened while the bridge was away.
            since: Math.floor(Date.now() / 1000) - 24 * 60 * 60,
          },
        ],
        onEvent,
        onClose: (reason) => {
          if (live.get(community.communityId)?.subscription === subscription) {
            live.delete(community.communityId);
            log(`subscription to ${community.relayUrl} closed: ${reason}`);
          }
        },
      });
      live.set(community.communityId, { key, subscription });
      subscription.ready.then(
        () =>
          log(
            `listening on ${community.relayUrl} (${community.channelIds.length} channels)`,
          ),
        () => {},
      );
    }
  }

  let stopping = false;
  const stop = () => {
    stopping = true;
    for (const { subscription } of live.values()) subscription.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  let lastRoomSweep = 0;
  let lastMemberSweep = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastRoomSweep > 30_000) {
        lastRoomSweep = Date.now();
        for (const room of await unlinkedBuzzRooms()) {
          await syncRoomChannel(room.id);
          log(`out room ${room.id.slice(0, 8)} → channel`);
        }
      }
      // Members can change with no message to carry it (someone leaves the
      // organization). Cheap when nothing changed: a hash compare per room.
      if (Date.now() - lastMemberSweep > 60_000) {
        lastMemberSweep = Date.now();
        for (const room of await linkedBuzzRooms()) {
          try {
            await syncRoomChannel(room.roomId);
          } catch (error) {
            log(
              `out room ${room.roomId.slice(0, 8)} member sync failed`,
              error instanceof Error ? error.message : error,
            );
          }
        }
      }
      for (const outcome of await drainBuzzOutbox()) {
        if (outcome.result !== "unchanged" && outcome.result !== "skipped") {
          log(`out ${outcome.key.slice(0, 13)} → ${outcome.result}`);
        }
      }
      await refreshSubscriptions();
    } catch (error) {
      log("loop error", error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  await inbound;
}

try {
  if (command === "enable") await enable();
  else if (command === "status") await status();
  else if (command === "run") await run();
  else {
    console.log("usage: buzz:bridge enable --org <id|slug> | run | status");
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
