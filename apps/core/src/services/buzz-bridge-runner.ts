/**
 * The Buzz bridge loop: keeps organizations' chats and their Buzz communities
 * in step, in both directions. Run by `/sync/buzz` (one leased run at a time)
 * and by `pnpm buzz:bridge run` locally.
 */
import type { Event } from "nostr-tools/pure";
import { INBOUND_KINDS } from "@/lib/buzz/events";
import {
  queryAllEvents,
  type RelaySubscription,
  subscribe,
} from "@/lib/buzz/relay-client";
import { withinBridgeRun } from "@/lib/buzz/run-scope";
import prisma from "@/lib/db/prisma";
import {
  applyInboundEvent,
  BuzzTargetPendingError,
  buzzConfig,
  buzzSubscriptions,
  CoreRejectedError,
  type CoreRequest,
  claimBuzzState,
  deleteChannelsOfDeletedRooms,
  drainBuzzOutbox,
  linkedBuzzRooms,
  markBuzzQuestionAnswered,
  provisionBuzzCommunities,
  readerSecretKey,
  recordFailedBuzzAnswer,
  removeAgentsWithoutOwner,
  repairBuzzOutbox,
  saveInboundCursor,
  syncBuzzAgents,
  syncBuzzBans,
  syncRoomChannel,
  unlinkedBuzzRooms,
} from "@/services/buzz-bridge.service";
import {
  importBuzzHistory,
  importDepartedMessage,
} from "@/services/buzz-history-import.service";
import {
  type AcquiredSyncLock,
  syncLockService,
} from "@/services/sync-lock.service";

export type BridgeLog = (message: string, extra?: unknown) => void;

const LEASE_KEY = "buzz-bridge";
// The relay takes events up to 15 minutes from its clock; reading back 16
// covers one published late with an old time, and some clock skew.
const CATCH_UP_WINDOW_S = 16 * 60;
const AGENT_SWEEP_KEY = "buzz-agent-sweep";
// Subscriptions opened at once: each first reads its backlog.
const OPEN_CONCURRENCY = 10;
// A run that stops renewing (its function was killed) frees the lease this
// soon, so the next run takes over within a minute.
const LEASE_TIMEOUT_MS = 90_000;
const LEASE_RENEW_MS = 15_000;

/**
 * Runs the bridge while holding its lease, so exactly one run is active at a
 * time. Waits up to `waitMs` for a run that is finishing to hand over, and
 * stops at `until` (a timestamp), when the lease is lost, or when
 * `shouldContinue` says so. Returns false when the lease never came free.
 */
/**
 * Core refuses access (401/403) while a membership is still syncing, so those
 * are retried; but one still refused half an hour after it was written is
 * given up after a few tries, or a room that turned read-only would hold its
 * community's cursor forever. Judged by the event's age, so it holds across
 * runs.
 */
const FORBIDDEN_FOR_S = 30 * 60;

export function rejectedForGood(
  error: unknown,
  attempt: number,
  createdAt: number,
  now = Date.now(),
): boolean {
  if (!(error instanceof CoreRejectedError)) return false;
  if (error.terminal) return true;
  return (
    (error.status === 401 || error.status === 403) &&
    attempt >= 2 &&
    now / 1000 - createdAt > FORBIDDEN_FOR_S
  );
}

export async function runLeasedBuzzBridge(options: {
  core: CoreRequest;
  log: BridgeLog;
  until: number;
  waitMs: number;
  shouldContinue?: () => boolean;
}): Promise<boolean> {
  const giveUpAt = Date.now() + options.waitMs;
  let lock: AcquiredSyncLock | undefined;
  while (!lock) {
    try {
      lock = await syncLockService.acquireLock(LEASE_KEY, LEASE_TIMEOUT_MS);
    } catch (error) {
      if (!(error instanceof Error && error.message === "LOCK_IS_LOCKED"))
        throw error;
      if (Date.now() >= giveUpAt || options.shouldContinue?.() === false)
        return false;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  const held = lock;
  let holding = true;
  let renewedAt = Date.now();
  const renewal = setInterval(() => {
    syncLockService.renewLock(held.key, held.ownerToken).then(
      (renewed) => {
        if (renewed) renewedAt = Date.now();
        else {
          holding = false;
          options.log("lease lost to another run; stopping");
        }
      },
      (error) =>
        options.log(
          "lease renewal failed",
          error instanceof Error ? error.message : error,
        ),
    );
  }, LEASE_RENEW_MS);
  try {
    // Stops when a lease it could not renew is half gone: what is in flight
    // then (a Core call ends within 30 s, a relay one within 15 s) ends
    // before another run could take over.
    const shouldContinue = () =>
      holding &&
      Date.now() - renewedAt < LEASE_TIMEOUT_MS / 2 &&
      Date.now() < options.until &&
      options.shouldContinue?.() !== false;
    // State copied from another deployment is never acted on.
    if (!(await claimBuzzState(options.log))) return true;
    // Every write in the run checks this too, not only the loop.
    await withinBridgeRun(shouldContinue, () =>
      runBuzzBridge({
        core: options.core,
        log: options.log,
        shouldContinue,
      }),
    );
  } finally {
    clearInterval(renewal);
    await syncLockService
      .releaseLock(held.key, held.ownerToken)
      .catch((error) => options.log("lease release failed", error));
  }
  return true;
}

export function coreRequester(baseUrl: string): CoreRequest {
  return async ({
    method,
    path,
    apiKey,
    body,
    timeoutMs,
    streamed,
    headers,
  }) => {
    // Core answers (or starts a stream) within 30 s, whatever follows: a run
    // never waits longer than that on one request before it can stop. A
    // stream may then take up to `timeoutMs` to read, in the background.
    const answered = new AbortController();
    const startBy = setTimeout(() => answered.abort(), 30_000);
    const reading = AbortSignal.timeout(timeoutMs ?? 30_000);
    let response: Response;
    try {
      response = await fetch(new URL(path, baseUrl), {
        method,
        headers: {
          ...headers,
          authorization: `Bearer ${apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([answered.signal, reading]),
      });
    } finally {
      clearTimeout(startBy);
    }
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

/**
 * A UI message stream that finished: a `finish` chunk, and no `error` or
 * `abort`. One cut off or aborted is no answer.
 */
function streamEndedWell(text: string): boolean {
  const types = text.split("\n").flatMap((line) => {
    if (!line.startsWith("data: ")) return [];
    try {
      return [(JSON.parse(line.slice(6)) as { type?: unknown }).type];
    } catch {
      return [];
    }
  });
  return (
    types.includes("finish") &&
    !types.includes("error") &&
    !types.includes("abort")
  );
}

/** Older events first, the order Sokosumi should see them in. */
function chronological(events: Event[]): Event[] {
  return events.toSorted(
    (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
  );
}

/** Every stored event from `since` on, so a long outage loses nothing. */
async function backlog(input: {
  relayUrl: string;
  secretKey: Uint8Array;
  channelIds: string[];
  since: number;
}): Promise<Event[]> {
  return chronological(
    await queryAllEvents({
      relayUrl: input.relayUrl,
      secretKey: input.secretKey,
      filter: {
        kinds: INBOUND_KINDS,
        "#h": input.channelIds,
        since: input.since,
      },
    }),
  );
}

/**
 * One run of the bridge: catches up from the saved cursors, then keeps
 * Sokosumi and Buzz in step until `shouldContinue` says stop. Only one run at
 * a time may be active (the caller holds the lease); the next one resumes
 * from the cursors this one saved.
 */
export async function runBuzzBridge(options: {
  core: CoreRequest;
  log: BridgeLog;
  shouldContinue: () => boolean;
}): Promise<void> {
  const config = buzzConfig();
  if (!config) {
    throw new Error(
      "Set BUZZ_COMMUNITY_URL_TEMPLATE, BUZZ_OPERATOR_SECRET_KEY and BUZZ_KEY_ENCRYPTION_SECRET",
    );
  }
  const { core, log } = options;
  log(`running as operator ${config.operatorPubkey.slice(0, 8)}…`);

  // Inbound events are applied one at a time, in order. One whose target is
  // not linked yet waits (up to 6 tries, then is applied as well as it can
  // be); one that fails because Core is unreachable is retried until it works,
  // one Core keeps refusing access to only for a while (see rejectedForGood).
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
    // An event dated ahead (the relay allows 15 minutes) never moves the
    // cursor past now, or catching up would start after events still due.
    newestDone.set(
      communityId,
      Math.max(
        newestDone.get(communityId) ?? 0,
        Math.min(event.created_at, Math.floor(Date.now() / 1000)),
      ),
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

  // `attempt` counts tries to apply the event (for the backoff);
  // `failedAnswers`, Coworker answers that failed once started; `targetWaits`,
  // waits on a target that is not on its way in. Each has its own limit, so a
  // run of transient failures does not give up on a target, or an answer.
  const apply = (
    communityId: string,
    event: Event,
    attempt: number,
    failedAnswers = 0,
    targetWaits = 0,
  ) => {
    if (stopping) return;
    inbound = inbound.then(async () => {
      // Shutting down, or the lease is gone: not applied now, it stays
      // behind the saved cursor for the run that holds the lease.
      if (stopping || !options.shouldContinue()) return;
      const finalAttempt = targetWaits + 1 >= TARGET_ATTEMPTS;
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
          // Counted on the question, so the limit holds across runs; at the
          // limit it is recorded as answered (given up) and not asked again.
          const failures = ok
            ? 0
            : await recordFailedBuzzAnswer(event.id, ANSWER_ATTEMPTS).catch(
                (error) => {
                  log(`in  ${id} failed answer not recorded`, error);
                  return failedAnswers + 1;
                },
              );
          if (ok || failures >= ANSWER_ATTEMPTS) {
            if (!ok)
              log(`in  kind ${event.kind} ${id} answer failed, giving up`);
            finish(communityId, event);
            return;
          }
          log(`in  kind ${event.kind} ${id} answer failed, asking again`);
          retryLater(
            () =>
              apply(
                communityId,
                event,
                attempt,
                failedAnswers + 1,
                targetWaits,
              ),
            Math.min(2_000 * 2 ** failedAnswers, 5 * 60_000),
          );
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // Core said no for good (the message is gone, the reaction too
        // long), or keeps refusing access: retrying would hold the cursor
        // forever.
        if (rejectedForGood(error, attempt, event.created_at)) {
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
            () =>
              apply(communityId, event, attempt, failedAnswers, targetWaits),
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
          () =>
            apply(
              communityId,
              event,
              attempt + 1,
              failedAnswers,
              waiting ? targetWaits + 1 : targetWaits,
            ),
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
      // Never past the newest finished event: an unfinished one may be dated
      // ahead.
      const cursor =
        open.length > 0 ? Math.min(Math.min(...open) - 1, done) : done;
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
        ? // The relay takes events up to 15 minutes old: one published late
          // with an old time still lands within this window.
          community.inboundCursor - CATCH_UP_WINDOW_S
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
          since: caughtUpTo - CATCH_UP_WINDOW_S,
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
    // Live only once the relay let it in: until then the slot is still
    // opening, so the community's cursor waits. One that stalls is closed
    // and tried again.
    try {
      await Promise.race([
        subscription.ready,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("subscription not ready in 20s")),
            20_000,
          ),
        ),
      ]);
    } catch (error) {
      live.delete(slot);
      subscription.close();
      throw error;
    }
    reconnect.delete(slot);
    log(
      `listening on ${community.relayUrl} as ${reader.readerId === "operator" ? "operator" : "a DM member"} (${reader.channelIds.length} channels, ${missed.length} caught up)`,
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
    const toOpen: {
      community: (typeof communities)[number];
      reader: (typeof communities)[number]["readers"][number];
      slot: string;
      key: string;
    }[] = [];
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
        toOpen.push({ community, reader, slot, key });
      }
    }
    // A few at a time, in no fixed order: a run that must stop before all
    // are open leaves different ones for the next run, never the same.
    toOpen.sort(() => Math.random() - 0.5);
    const openOne = async () => {
      for (;;) {
        const next = toOpen.pop();
        if (!next || !options.shouldContinue()) return;
        const { community, reader, slot, key } = next;
        live.get(slot)?.subscription.close();
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
    };
    await Promise.all(Array.from({ length: OPEN_CONCURRENCY }, openOne));
    // Each reader is a connection; one function holds about a thousand.
    if (live.size > 800) {
      log(`${live.size} live subscriptions: near what one run can hold`);
    }
  }

  const stop = () => {
    stopping = true;
    for (const timer of retries) clearTimeout(timer);
    retries.clear();
    for (const { subscription } of live.values()) subscription.close();
  };

  let lastRoomSweep = 0;
  const roomRests = new Map<string, number>();
  let lastMemberSweep = 0;
  let lastAgentSweep = 0;
  // Where the member sweep goes on from; a fresh run starts anywhere, so a
  // sweep cut short never leaves the same rooms out every time.
  let memberSweepFrom = Math.floor(Math.random() * 1_000_000);
  // Upkeep gets this long per pass; messages are delivered between passes.
  const SWEEP_BUDGET_MS = 20_000;
  // Outbox delivery per pass; the loop comes back to it within a second.
  const DRAIN_BUDGET_MS = 10_000;
  const within = (until: number) => () =>
    Date.now() < until && options.shouldContinue();
  while (!stopping && options.shouldContinue()) {
    try {
      if (Date.now() - lastRoomSweep > 30_000) {
        lastRoomSweep = Date.now();
        const inBudget = within(Date.now() + SWEEP_BUDGET_MS);
        try {
          const created = await provisionBuzzCommunities(25, inBudget);
          if (created > 0) log(`${created} communit(ies) created on the relay`);
        } catch (error) {
          log(
            "community provisioning failed",
            error instanceof Error ? error.message : error,
          );
        }
        const deleted = await deleteChannelsOfDeletedRooms(inBudget);
        if (deleted > 0) log(`${deleted} channel(s) of deleted rooms removed`);
        // A room that failed rests ten minutes, so the next ones get a turn.
        for (const [roomId, until] of roomRests) {
          if (until <= Date.now()) roomRests.delete(roomId);
        }
        for (const room of await unlinkedBuzzRooms(50, [...roomRests.keys()])) {
          if (!inBudget()) break;
          // One room's trouble (its relay down) must not keep others off Buzz.
          try {
            if (await syncRoomChannel(room.id)) {
              log(`out room ${room.id.slice(0, 8)} → channel`);
            } else {
              // Nowhere to go yet (a Direct whose people share no community).
              roomRests.set(room.id, Date.now() + 10 * 60_000);
            }
          } catch (error) {
            roomRests.set(room.id, Date.now() + 10 * 60_000);
            log(
              `out room ${room.id.slice(0, 8)} channel failed`,
              error instanceof Error ? error.message : error,
            );
          }
        }
        // Rooms that just reached Buzz bring their history along.
        try {
          if (inBudget()) {
            await importBuzzHistory({ log, shouldContinue: inBudget });
          }
        } catch (error) {
          log(
            "history import failed",
            error instanceof Error ? error.message : error,
          );
        }
      }
      // Agents people run in their Buzz apps: a slice of people at a time,
      // after rooms had their turn. Its trouble holds up nothing else.
      if (Date.now() - lastAgentSweep > 120_000) {
        lastAgentSweep = Date.now();
        try {
          // Where the last pass stopped, kept across runs.
          const saved = await prisma.syncMetadata.findUnique({
            where: { key: AGENT_SWEEP_KEY },
          });
          const agentSweep = { after: saved?.cursorId ?? null };
          const changed = await syncBuzzAgents({
            progress: agentSweep,
            limit: 200,
            shouldContinue: within(Date.now() + SWEEP_BUDGET_MS),
            mayWrite: options.shouldContinue,
          });
          await prisma.syncMetadata.upsert({
            where: { key: AGENT_SWEEP_KEY },
            create: {
              key: AGENT_SWEEP_KEY,
              lastSyncedAt: new Date(),
              cursorId: agentSweep.after,
            },
            update: { lastSyncedAt: new Date(), cursorId: agentSweep.after },
          });
          for (const change of changed) {
            log(`agent ${change.slice(0, 13)} synced`);
          }
        } catch (error) {
          log(
            "agent sync failed",
            error instanceof Error ? error.message : error,
          );
        }
      }
      // Members can change with no message to carry it (someone leaves the
      // organization). Cheap when nothing changed: a hash compare per room.
      if (Date.now() - lastMemberSweep > 60_000) {
        lastMemberSweep = Date.now();
        const repaired = await repairBuzzOutbox();
        if (repaired > 0) log(`${repaired} change(s) queued again for Buzz`);
        const left = await removeAgentsWithoutOwner();
        if (left > 0) log(`${left} personal agent(s) left with their owner`);
        try {
          const bans = await syncBuzzBans();
          if (bans > 0) log(`${bans} ban(s) carried to Buzz`);
        } catch (error) {
          log(
            "ban sync failed",
            error instanceof Error ? error.message : error,
          );
        }
        const inBudget = within(Date.now() + SWEEP_BUDGET_MS);
        const rooms = await linkedBuzzRooms();
        for (let done = 0; done < rooms.length && inBudget(); done++) {
          const room = rooms[memberSweepFrom++ % rooms.length];
          if (!room) continue;
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
      // Readers first, then a bounded pass of the outbox: neither direction
      // can hold the other up.
      await refreshSubscriptions();
      for (const outcome of await drainBuzzOutbox({
        shouldContinue: within(Date.now() + DRAIN_BUDGET_MS),
        backfill: importDepartedMessage,
      })) {
        if (outcome.result !== "unchanged" && outcome.result !== "skipped") {
          log(`out ${outcome.key.slice(0, 13)} → ${outcome.result}`);
        }
      }
      await saveCursors();
    } catch (error) {
      log("loop error", error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  stop();
  // The change being applied finishes (a Core call ends within its timeout)
  // before the lease is handed over; nothing queued after it starts. What is
  // still waiting (a retry, a streaming answer) stays behind the saved
  // cursor for the next run.
  await inbound;
  await saveCursors().catch((error) =>
    log("cursor save failed", error instanceof Error ? error.message : error),
  );
}
