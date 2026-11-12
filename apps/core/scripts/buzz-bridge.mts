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
import {
  queryEvents,
  type RelaySubscription,
  subscribe,
} from "@/lib/buzz/relay-client";
import prisma from "@/lib/db/prisma";
import {
  applyInboundEvent,
  BuzzTargetPendingError,
  buzzConfig,
  buzzSubscriptions,
  CoreRejectedError,
  type CoreRequest,
  deleteChannelsOfDeletedRooms,
  drainBuzzOutbox,
  enableBuzzForOrganization,
  linkedBuzzRooms,
  markBuzzQuestionAnswered,
  readerSecretKey,
  removeAgentsWithoutOwner,
  saveInboundCursor,
  syncBuzzAgents,
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
      organization: c.organization?.name ?? "(deleted)",
      relay: c.relayUrl,
      channels: c._count.channels,
      members: c._count.members,
    })),
  );
  log(`${messages} messages, ${reactions} reactions linked; outbox ${outbox}`);
}

function coreRequester(baseUrl: string): CoreRequest {
  return async ({ method, path, apiKey, body, timeoutMs, streamed }) => {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs ?? 30_000),
    });
    // A stream has started once its headers are in: answer then, and keep
    // reading it so the answer is not cut off and a failure is seen.
    if (streamed && response.ok) {
      return {
        status: response.status,
        body: null,
        finished: response.text().then(streamEndedWell, () => false),
      };
    }
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

/** A UI message stream that carries no `error` chunk. */
function streamEndedWell(text: string): boolean {
  return !text.split("\n").some((line) => {
    if (!line.startsWith("data: ")) return false;
    try {
      return (JSON.parse(line.slice(6)) as { type?: unknown }).type === "error";
    } catch {
      return false;
    }
  });
}

/** Older events first, the order Sokosumi should see them in. */
function chronological(events: Event[]): Event[] {
  return events.toSorted(
    (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
  );
}

/**
 * Every stored event from `since` on, paged backwards (the relay answers
 * newest-first and caps a page), so a long outage loses nothing.
 */
async function backlog(input: {
  relayUrl: string;
  secretKey: Uint8Array;
  channelIds: string[];
  since: number;
}): Promise<Event[]> {
  const PAGE = 500;
  const found = new Map<string, Event>();
  let until = Math.floor(Date.now() / 1000);
  // `until` only moves back, so this ends; no page cap, which would skip
  // the oldest of a long outage.
  for (;;) {
    const events = await queryEvents({
      relayUrl: input.relayUrl,
      secretKey: input.secretKey,
      filters: [
        {
          kinds: INBOUND_KINDS,
          "#h": input.channelIds,
          since: input.since,
          until,
          limit: PAGE,
        },
      ],
    });
    for (const event of events) found.set(event.id, event);
    if (events.length < PAGE) break;
    const oldest = Math.min(...events.map((event) => event.created_at));
    if (oldest === until) {
      // A whole page in one second: read that second in full, then go on
      // before it, so no event in a crowded second is skipped.
      for (const event of await queryEvents({
        relayUrl: input.relayUrl,
        secretKey: input.secretKey,
        filters: [
          {
            kinds: INBOUND_KINDS,
            "#h": input.channelIds,
            since: oldest,
            until: oldest,
            limit: 50_000,
          },
        ],
      })) {
        found.set(event.id, event);
      }
      until = oldest - 1;
    } else {
      // Inclusive, so events sharing the oldest second are read again.
      until = oldest;
    }
    if (until < input.since) break;
  }
  return chronological([...found.values()]);
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

  // Inbound events are applied one at a time, in order. One whose target is
  // not linked yet waits (up to 6 tries, then is applied as well as it can
  // be); one that fails because Core is unreachable is retried until it works.
  let inbound = Promise.resolve();
  const seen = new Set<string>();
  const TARGET_ATTEMPTS = 6;
  // A Coworker answer that fails after it started is asked for again a few times.
  const ANSWER_ATTEMPTS = 4;
  // Per community: events not finished yet, and the newest one finished. The
  // saved cursor never passes an unfinished event.
  const unfinished = new Map<string, Map<string, number>>();
  const newestDone = new Map<string, number>();

  const finish = (communityId: string, event: Event) => {
    unfinished.get(communityId)?.delete(event.id);
    newestDone.set(
      communityId,
      Math.max(newestDone.get(communityId) ?? 0, event.created_at),
    );
  };

  let stopping = false;
  // Retries are cancelled on shutdown, and none is scheduled after it.
  const retries = new Set<ReturnType<typeof setTimeout>>();
  const retryLater = (retry: () => void, delay: number) => {
    if (stopping) return;
    const timer = setTimeout(() => {
      retries.delete(timer);
      retry();
    }, delay);
    retries.add(timer);
  };

  // `attempt` counts tries to apply the event; `failedAnswers`, Coworker
  // answers that failed once started, which have their own limit.
  const apply = (
    communityId: string,
    event: Event,
    attempt: number,
    failedAnswers = 0,
  ) => {
    if (stopping) return;
    inbound = inbound.then(async () => {
      const finalAttempt = attempt + 1 >= TARGET_ATTEMPTS;
      // A target still on its way in (say Core is down and it keeps
      // retrying) is worth waiting for however long that takes.
      try {
        let answer: Promise<boolean> | undefined;
        const result = await applyInboundEvent(event, core, {
          finalAttempt,
          onTurnStarted: (finished) => {
            answer = finished;
          },
        });
        const id = event.id.slice(0, 8);
        if (result !== "echo" && result !== "ignored") {
          log(`in  kind ${event.kind} ${id} → ${result}`);
        }
        if (!answer) {
          finish(communityId, event);
          return;
        }
        // A Coworker's answer is still streaming: the event stays unfinished
        // (so is the saved cursor) until it ends, and is asked again if it
        // fails.
        void answer.then(async (ok) => {
          if (ok) {
            await markBuzzQuestionAnswered(event.id).catch((error) =>
              log(`in  ${id} answer not recorded`, error),
            );
          }
          if (ok || failedAnswers + 1 >= ANSWER_ATTEMPTS) {
            if (!ok)
              log(`in  kind ${event.kind} ${id} answer failed, giving up`);
            finish(communityId, event);
            return;
          }
          log(`in  kind ${event.kind} ${id} answer failed, asking again`);
          retryLater(
            () => apply(communityId, event, attempt, failedAnswers + 1),
            Math.min(2_000 * 2 ** failedAnswers, 5 * 60_000),
          );
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // Core said no for good (the message is gone, the reaction too
        // long): retrying would hold the cursor forever.
        if (error instanceof CoreRejectedError && error.terminal) {
          log(
            `in  kind ${event.kind} ${event.id.slice(0, 8)} → rejected`,
            reason,
          );
          finish(communityId, event);
          return;
        }
        const waiting = error instanceof BuzzTargetPendingError;
        const targetInFlight =
          waiting &&
          [...unfinished.values()].some((open) =>
            open.has(error.targetEventId),
          );
        const delay = Math.min(2_000 * 2 ** attempt, 5 * 60_000);
        if (targetInFlight) {
          retryLater(
            () => apply(communityId, event, attempt, failedAnswers),
            delay,
          );
          return;
        }
        if (!waiting) {
          log(
            `in  kind ${event.kind} ${event.id.slice(0, 8)} failed, retry in ${delay / 1000}s`,
            reason,
          );
        }
        retryLater(
          () => apply(communityId, event, attempt + 1, failedAnswers),
          delay,
        );
      }
    });
  };

  const accept = (communityId: string, event: Event) => {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 100_000) seen.clear();
    const open = unfinished.get(communityId) ?? new Map<string, number>();
    open.set(event.id, event.created_at);
    unfinished.set(communityId, open);
    apply(communityId, event, 0);
  };

  async function saveCursors() {
    for (const [communityId, done] of newestDone) {
      // A reader that is down or still catching up has not read up to here:
      // hold the community's cursor until every reader is live again.
      const readers = expected.get(communityId) ?? [];
      if (readers.some((slot) => !live.has(slot) || opening.has(slot))) {
        continue;
      }
      const open = [...(unfinished.get(communityId)?.values() ?? [])];
      const cursor = open.length > 0 ? Math.min(...open) - 1 : done;
      if (cursor > 0) await saveInboundCursor(communityId, cursor);
    }
  }

  // One live subscription per (community, reader), reopened when its channel
  // set changes or it drops. Each (re)open first replays the backlog since
  // the saved cursor, oldest first, then follows live.
  const live = new Map<
    string,
    { key: string; subscription: RelaySubscription }
  >();
  const reconnect = new Map<string, { failures: number; at: number }>();
  const opening = new Set<string>();
  // Per community, the reader slots it should have.
  const expected = new Map<string, string[]>();

  async function open(
    community: Awaited<ReturnType<typeof buzzSubscriptions>>[number],
    reader: { readerId: string; channelIds: string[] },
    slot: string,
    key: string,
  ) {
    const secretKey = await readerSecretKey(reader.readerId);
    const since =
      community.inboundCursor > 0
        ? community.inboundCursor - 10 * 60
        : Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    const caughtUpTo = Math.floor(Date.now() / 1000);
    const missed = await backlog({
      relayUrl: community.relayUrl,
      secretKey,
      channelIds: reader.channelIds,
      since,
    });
    for (const event of missed) accept(community.communityId, event);
    const subscription = subscribe({
      relayUrl: community.relayUrl,
      secretKey,
      filters: [
        {
          kinds: INBOUND_KINDS,
          "#h": reader.channelIds,
          since: caughtUpTo - 5,
        },
      ],
      onEvent: (event) => accept(community.communityId, event),
      onClose: (reason) => {
        if (live.get(slot)?.subscription !== subscription) return;
        live.delete(slot);
        const failures = (reconnect.get(slot)?.failures ?? 0) + 1;
        const wait = Math.min(1_000 * 2 ** (failures - 1), 30_000);
        reconnect.set(slot, { failures, at: Date.now() + wait });
        log(
          `subscription ${slot.slice(0, 20)} closed: ${reason}; retry in ${wait / 1000}s`,
        );
      },
    });
    live.set(slot, { key, subscription });
    subscription.ready.then(
      () => {
        reconnect.delete(slot);
        log(
          `listening on ${community.relayUrl} as ${reader.readerId === "operator" ? "operator" : "a DM member"} (${reader.channelIds.length} channels, ${missed.length} caught up)`,
        );
      },
      () => {},
    );
  }

  async function refreshSubscriptions() {
    const communities = await buzzSubscriptions();
    // A reader with nothing left to read (its last DM gone, its community
    // deleted) is closed, not left open until shutdown.
    const wanted = new Set(
      communities.flatMap((community) =>
        community.readers.map(
          (reader) => `${community.communityId}:${reader.readerId}`,
        ),
      ),
    );
    for (const [slot, { subscription }] of live) {
      if (wanted.has(slot)) continue;
      // Out of `live` first, so its close is not taken for a drop.
      live.delete(slot);
      reconnect.delete(slot);
      subscription.close();
      log(`closed ${slot.slice(0, 20)}: nothing left to read`);
    }
    const communityIds = new Set(communities.map((c) => c.communityId));
    for (const communityId of expected.keys()) {
      if (!communityIds.has(communityId)) expected.delete(communityId);
    }
    for (const community of communities) {
      expected.set(
        community.communityId,
        community.readers.map(
          (reader) => `${community.communityId}:${reader.readerId}`,
        ),
      );
      for (const reader of community.readers) {
        const slot = `${community.communityId}:${reader.readerId}`;
        const key = reader.channelIds.toSorted().join(",");
        const current = live.get(slot);
        if (current?.key === key || opening.has(slot)) continue;
        const retry = reconnect.get(slot);
        if (!current && retry && Date.now() < retry.at) continue;
        current?.subscription.close();
        live.delete(slot);
        opening.add(slot);
        try {
          await open(community, reader, slot, key);
        } catch (error) {
          const failures = (reconnect.get(slot)?.failures ?? 0) + 1;
          const wait = Math.min(1_000 * 2 ** (failures - 1), 30_000);
          reconnect.set(slot, { failures, at: Date.now() + wait });
          log(
            `catch-up ${slot.slice(0, 20)} failed; retry in ${wait / 1000}s`,
            error instanceof Error ? error.message : error,
          );
        } finally {
          opening.delete(slot);
        }
      }
    }
  }

  const stop = () => {
    stopping = true;
    for (const timer of retries) clearTimeout(timer);
    retries.clear();
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
        for (const change of await syncBuzzAgents()) {
          log(`agent ${change.slice(0, 13)} synced`);
        }
        const deleted = await deleteChannelsOfDeletedRooms();
        if (deleted > 0) log(`${deleted} channel(s) of deleted rooms removed`);
        for (const room of await unlinkedBuzzRooms()) {
          await syncRoomChannel(room.id);
          log(`out room ${room.id.slice(0, 8)} → channel`);
        }
      }
      // Members can change with no message to carry it (someone leaves the
      // organization). Cheap when nothing changed: a hash compare per room.
      if (Date.now() - lastMemberSweep > 60_000) {
        lastMemberSweep = Date.now();
        const left = await removeAgentsWithoutOwner();
        if (left > 0) log(`${left} personal agent(s) left with their owner`);
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
      await saveCursors();
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
