import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import * as Sentry from "@sentry/node";
import type { Prisma } from "@sokosumi/database";
import { getEnv } from "@/config/env";
import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { publishChatRoomsChanged } from "@/lib/ably/publish";
import {
  CHAT_SIGNAL_MODEL,
  CHAT_SIGNAL_VERSION,
  type ChatSignalBatch,
  type ChatSignalEvaluator,
  chatSignalAddressees,
  tagChatSignalBatch,
} from "@/lib/chat-signals/jev-tagger";
import {
  CHAT_SIGNAL_THRESHOLD,
  isTooShortForChatSignals,
  resolveChatSignalDueAt,
} from "@/lib/chat-signals/tags";
import prisma from "@/lib/db/prisma";
import { createCoreLogger } from "@/lib/evlog";
import type { SyncExecutionContext } from "@/routes/sync/handler";
import {
  captureExternalRoomContacts,
  notifyChatSignalReaders,
  type TaggedChatMessage,
} from "@/services/chat-signal-effects.service";

/**
 * A burst is one batch: a room's messages wait until it has been quiet this
 * long, and never longer than the cap below, before one Jev call reads them.
 */
const DEBOUNCE_MS = 4_000;
const MAX_WAIT_MS = 20_000;
/** Rows the live flush left behind (a lost waitUntil) wait this long for the sweep. */
const SWEEP_AFTER_MS = 30_000;
const MAX_BATCH = 15;
const MAX_ATTEMPTS = 3;
const LEASE_MS = 60_000;
const JEV_TIMEOUT_MS = 12_000;
const EARLIER_CONTEXT = 4;
/** The sweep's per-tick bound, beside its time budget. */
const MAX_SWEEP_ROOMS = 40;
const SWEEP_RESERVE_MS = 15_000;

export type ChatSignalSkipReason =
  | "not_human"
  | "deleted"
  | "too_short"
  | "solo_direct"
  | "direct_not_opted_in";

interface EligibilityInput {
  senderUserId: string | null;
  deleted: boolean;
  content: string;
  roomKind: string;
  /** Every human in the room and whether they let Jev read their Directs. */
  humans: readonly { tagDirectMessages: boolean }[];
}

/**
 * Whether Jev may read a message. Channels and external channels are read by
 * default. A Direct is person-to-person, so it is read only when every human
 * in it opted in; a Direct with one human (notes, an assistant) has nobody to
 * be asked anything and is never read.
 */
export function chatSignalSkipReason(
  input: EligibilityInput,
): ChatSignalSkipReason | null {
  if (!input.senderUserId) return "not_human";
  if (input.deleted) return "deleted";
  if (isTooShortForChatSignals(input.content)) return "too_short";
  if (input.roomKind === "direct") {
    if (input.humans.length < 2) return "solo_direct";
    if (!input.humans.every((human) => human.tagDirectMessages))
      return "direct_not_opted_in";
  }
  return null;
}

function enabled(): boolean {
  return Boolean(getEnv().AI_GATEWAY_API_KEY);
}

/**
 * Queues a just-sent message for tagging and flushes its room once the room
 * goes quiet. Schedule with `waitUntil`: it never blocks the send, and a
 * failure leaves a pending row the sweep picks up.
 */
export async function enqueueChatMessageSignal(
  messageId: string,
): Promise<void> {
  if (!enabled()) return;
  try {
    const message = await prisma.chatRoomMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        roomId: true,
        content: true,
        senderUserId: true,
        deletedAt: true,
        room: {
          select: {
            kind: true,
            userMembers: {
              select: { user: { select: { tagDirectMessages: true } } },
            },
          },
        },
      },
    });
    if (!message) return;
    const skip = chatSignalSkipReason({
      senderUserId: message.senderUserId,
      deleted: message.deletedAt !== null,
      content: message.content,
      roomKind: message.room.kind,
      humans: message.room.userMembers.map((member) => member.user),
    });
    if (skip) return;
    try {
      await prisma.chatMessageSignal.create({
        data: { messageId: message.id, roomId: message.roomId },
      });
    } catch (error) {
      if (!isPrismaUniqueViolation(error)) throw error;
    }
    await flushRoomWhenQuiet(message.roomId);
  } catch (error) {
    report(error, { messageId });
  }
}

/**
 * An edited message is read again: its old tags described other words. A
 * message never tagged stays untouched, so an edit cannot opt a Direct in.
 */
export async function requeueEditedChatMessageSignal(
  messageId: string,
): Promise<void> {
  if (!enabled()) return;
  try {
    const requeued = await prisma.chatMessageSignal.updateMany({
      where: { messageId, state: { in: ["tagged", "failed"] } },
      data: {
        state: "pending",
        attempts: 0,
        lease: null,
        availableAt: new Date(),
      },
    });
    if (requeued.count === 0) return;
    const signal = await prisma.chatMessageSignal.findUnique({
      where: { messageId },
      select: { roomId: true },
    });
    if (signal) await flushRoomWhenQuiet(signal.roomId);
  } catch (error) {
    report(error, { messageId });
  }
}

/**
 * Waits out the debounce, then tags the room unless a newer message is still
 * inside it: that message's own flush runs later and takes this one along.
 */
async function flushRoomWhenQuiet(roomId: string): Promise<void> {
  await sleep(DEBOUNCE_MS);
  const pending = await prisma.chatMessageSignal.aggregate({
    where: { roomId, state: "pending" },
    _min: { createdAt: true },
    _max: { createdAt: true },
  });
  const newest = pending._max.createdAt;
  const oldest = pending._min.createdAt;
  if (!newest || !oldest) return;
  const now = Date.now();
  if (
    now - newest.getTime() < DEBOUNCE_MS &&
    now - oldest.getTime() < MAX_WAIT_MS
  ) {
    return;
  }
  await tagRoomChatSignals(roomId, { source: "live" });
}

const MENTION_TOKEN =
  /@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9]{32}|all)(?::([\p{L}\p{N}_-]*))?(?![\p{L}\p{N}_-])/gu;

/** Message text as a person reads it: mention tokens become `@Name`. */
export function readableChatSignalText(
  content: string,
  names: ReadonlyMap<string, string>,
): string {
  return content.replace(
    MENTION_TOKEN,
    (_token, key: string, slug?: string) => {
      if (key === "all") return "@everyone";
      return `@${names.get(key) ?? slug ?? "someone"}`;
    },
  );
}

const senderSelect = {
  senderUserId: true,
  senderUser: { select: { name: true } },
  senderCoworker: { select: { name: true } },
  senderSokoBot: { select: { name: true } },
} as const satisfies Prisma.ChatRoomMessageSelect;

function senderName(message: {
  senderUser: { name: string } | null;
  senderCoworker: { name: string } | null;
  senderSokoBot: { name: string | null } | null;
}): string {
  return (
    message.senderUser?.name ??
    message.senderCoworker?.name ??
    message.senderSokoBot?.name ??
    "Someone"
  );
}

interface TagOutcome {
  claimed: number;
  tagged: number;
  costUsd: number;
}

/**
 * Claims a room's pending rows and tags them in one Jev call. Rows are
 * claimed by lease, so a live flush and the sweep never send one message
 * twice; a failure hands the rows back with a delay until their attempts
 * run out.
 */
export async function tagRoomChatSignals(
  roomId: string,
  options: { source: "live" | "sweep"; evaluate?: ChatSignalEvaluator },
): Promise<TagOutcome> {
  const log = createCoreLogger({ operation: "chat_message_signals" });
  const lease = randomUUID();
  const outcome: TagOutcome = { claimed: 0, tagged: 0, costUsd: 0 };
  try {
    const candidates = await prisma.chatMessageSignal.findMany({
      where: {
        roomId,
        state: "pending",
        availableAt: { lte: new Date() },
        attempts: { lt: MAX_ATTEMPTS },
      },
      orderBy: { createdAt: "asc" },
      take: MAX_BATCH,
      select: { id: true },
    });
    if (candidates.length === 0) return outcome;
    const claimed = await prisma.chatMessageSignal.updateMany({
      where: {
        id: { in: candidates.map((row) => row.id) },
        state: "pending",
        lease: null,
      },
      data: {
        state: "running",
        lease,
        attempts: { increment: 1 },
        availableAt: new Date(Date.now() + LEASE_MS),
      },
    });
    outcome.claimed = claimed.count;
    if (claimed.count === 0) return outcome;

    const { batch, deleted } = await loadBatch(roomId, lease);
    if (deleted.length > 0) {
      await prisma.chatMessageSignal.deleteMany({
        where: { id: { in: deleted }, lease },
      });
    }
    if (batch.messages.length === 0) return outcome;

    log.set({
      chatSignals: {
        source: options.source,
        model: CHAT_SIGNAL_MODEL,
        version: CHAT_SIGNAL_VERSION,
        roomKind: batch.roomKind,
        batchSize: batch.messages.length,
        people: batch.people.length,
      },
    });

    let result: Awaited<ReturnType<typeof tagChatSignalBatch>>;
    try {
      result = await tagChatSignalBatch(batch, {
        timeoutMs: JEV_TIMEOUT_MS,
        evaluate: options.evaluate,
      });
    } catch (error) {
      await releaseLease(lease);
      log.set({
        chatSignals: {
          outcome: "failed",
          reason: error instanceof Error ? error.name : "unknown",
        },
      });
      return outcome;
    }

    const now = new Date();
    const sentAt = new Map(
      (
        await prisma.chatRoomMessage.findMany({
          where: { id: { in: batch.messages.map((m) => m.messageId) } },
          select: { id: true, createdAt: true },
        })
      ).map((message) => [message.id, message.createdAt]),
    );
    const tagged: TaggedChatMessage[] = [];
    for (const [index, reading] of result.readings.entries()) {
      const message = batch.messages[index];
      const addressedUserIds = chatSignalAddressees(batch, message, reading);
      const committed =
        (reading.probabilities.commitment ?? 0) >= CHAT_SIGNAL_THRESHOLD;
      const written = await prisma.chatMessageSignal.updateMany({
        where: { messageId: reading.messageId, lease },
        data: {
          state: "tagged",
          lease: null,
          probabilities: reading.probabilities,
          addressedUserIds,
          commitmentDueAt: committed
            ? resolveChatSignalDueAt(
                reading.due,
                sentAt.get(reading.messageId) ?? now,
              )
            : null,
          model: CHAT_SIGNAL_MODEL,
          version: CHAT_SIGNAL_VERSION,
          taggedAt: now,
        },
      });
      outcome.tagged += written.count;
      if (written.count > 0)
        tagged.push({
          messageId: reading.messageId,
          authorUserId: message.authorUserId,
          probabilities: reading.probabilities,
          addressedUserIds,
          mentionedUserIds: message.mentionedUserIds,
          sentAt: sentAt.get(reading.messageId) ?? now,
        });
    }
    outcome.costUsd = result.costUsd;
    log.set({
      chatSignals: {
        outcome: "tagged",
        tagged: outcome.tagged,
        questions: result.questionCount,
        latencyMs: result.latencyMs,
        costUsd: result.costUsd,
        costPerMessageUsd:
          Math.round((result.costUsd / batch.messages.length) * 1e8) / 1e8,
        // Probabilities and the due choice only: never message text.
        ratings: result.readings.map((reading) => ({
          probabilities: reading.probabilities,
          due: reading.due,
          addressed: reading.addressee !== null,
        })),
      },
    });
    await announceTagged(
      roomId,
      batch.messages.map((message) => message.messageId),
    );
    const effects = await Promise.allSettled([
      notifyChatSignalReaders(roomId, tagged),
      batch.roomKind === "external"
        ? captureExternalRoomContacts(roomId, tagged)
        : Promise.resolve(0),
    ]);
    for (const effect of effects)
      if (effect.status === "rejected") report(effect.reason, { roomId });
    log.set({
      chatSignals: {
        notified: effects[0].status === "fulfilled" ? effects[0].value : 0,
        contactInteractions:
          effects[1].status === "fulfilled" ? effects[1].value : 0,
      },
    });
    return outcome;
  } catch (error) {
    await releaseLease(lease).catch(() => undefined);
    log.set({ chatSignals: { outcome: "failed", reason: "database_error" } });
    report(error, { roomId });
    return outcome;
  } finally {
    if (outcome.claimed > 0) log.emit();
  }
}

/** Hands claimed rows back, with a delay, or fails those out of attempts. */
async function releaseLease(lease: string): Promise<void> {
  await prisma.chatMessageSignal.updateMany({
    where: { lease, attempts: { gte: MAX_ATTEMPTS } },
    data: { state: "failed", lease: null },
  });
  await prisma.chatMessageSignal.updateMany({
    where: { lease },
    data: {
      state: "pending",
      lease: null,
      availableAt: new Date(Date.now() + LEASE_MS),
    },
  });
}

/** The claimed messages with what Jev needs to read them. */
async function loadBatch(
  roomId: string,
  lease: string,
): Promise<{ batch: ChatSignalBatch; deleted: string[] }> {
  const [room, signals] = await Promise.all([
    prisma.chatRoom.findUniqueOrThrow({
      where: { id: roomId },
      select: {
        name: true,
        groupName: true,
        kind: true,
        discoverability: true,
        userMembers: {
          select: { userId: true, user: { select: { name: true } } },
        },
      },
    }),
    prisma.chatMessageSignal.findMany({
      where: { roomId, lease },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        message: {
          select: {
            id: true,
            content: true,
            createdAt: true,
            deletedAt: true,
            ...senderSelect,
            userMentionsAsSource: { select: { userId: true } },
            parentMessage: { select: { content: true, deletedAt: true } },
          },
        },
      },
    }),
  ]);
  const people = room.userMembers.map((member) => ({
    userId: member.userId,
    name: member.user.name,
  }));
  const names = new Map(people.map((person) => [person.userId, person.name]));
  const live = signals.filter(
    (signal) =>
      signal.message.deletedAt === null && signal.message.senderUserId,
  );
  const deleted = signals
    .filter((signal) => !live.includes(signal))
    .map((signal) => signal.id);
  const oldest = live[0]?.message.createdAt;
  const earlier = oldest
    ? await prisma.chatRoomMessage.findMany({
        where: {
          roomId,
          deletedAt: null,
          parentMessageId: null,
          createdAt: { lt: oldest },
        },
        orderBy: { createdAt: "desc" },
        take: EARLIER_CONTEXT,
        select: { content: true, ...senderSelect },
      })
    : [];

  return {
    deleted,
    batch: {
      roomKind:
        room.kind === "direct"
          ? "direct"
          : room.discoverability === "external"
            ? "external"
            : "channel",
      roomName: room.groupName ?? room.name,
      people,
      earlier: earlier.reverse().map((message) => ({
        authorName: senderName(message),
        text: readableChatSignalText(message.content, names),
      })),
      messages: live.map(({ message }) => ({
        messageId: message.id,
        authorUserId: message.senderUserId ?? "",
        authorName: senderName(message),
        text: readableChatSignalText(message.content, names),
        repliesTo:
          message.parentMessage && message.parentMessage.deletedAt === null
            ? readableChatSignalText(message.parentMessage.content, names)
            : null,
        mentionedUserIds: message.userMentionsAsSource.map(
          (mention) => mention.userId,
        ),
      })),
    },
  };
}

/**
 * Tags change what a message shows and what the room counts as needing its
 * readers, so both the messages and the readers' room lists refresh.
 */
async function announceTagged(
  roomId: string,
  messageIds: readonly string[],
): Promise<void> {
  await Promise.allSettled(
    messageIds.map((messageId) =>
      publishChatRoomMessageRealtimeById(messageId, "update"),
    ),
  );
  const members = await prisma.chatRoomUserMember.findMany({
    where: { roomId },
    select: { userId: true },
  });
  await publishChatRoomsChanged({
    userIds: members.map((member) => member.userId),
    collections: ["active"],
    roomId,
  }).catch((error) => report(error, { roomId }));
}

/**
 * The sweep behind the live flush: rows whose `waitUntil` was lost, rows a
 * failure handed back, and leases a crashed batch never released.
 */
export async function sweepChatMessageSignals(
  context: SyncExecutionContext,
  options: { evaluate?: ChatSignalEvaluator } = {},
): Promise<void> {
  // Without a Gateway key nothing can reach Jev; a scripted evaluator can.
  if (!options.evaluate && !enabled()) return;
  const now = Date.now();
  // A lease whose batch died: hand it back, or fail it when out of attempts.
  await prisma.chatMessageSignal.updateMany({
    where: {
      state: "running",
      availableAt: { lte: new Date(now) },
      attempts: { gte: MAX_ATTEMPTS },
    },
    data: { state: "failed", lease: null },
  });
  await prisma.chatMessageSignal.updateMany({
    where: { state: "running", availableAt: { lte: new Date(now) } },
    data: { state: "pending", lease: null },
  });
  const rooms = await prisma.chatMessageSignal.groupBy({
    by: ["roomId"],
    where: {
      state: "pending",
      attempts: { lt: MAX_ATTEMPTS },
      availableAt: { lte: new Date(now) },
      createdAt: { lte: new Date(now - SWEEP_AFTER_MS) },
    },
    orderBy: { roomId: "asc" },
    take: MAX_SWEEP_ROOMS,
  });
  const summary = { rooms: rooms.length, claimed: 0, tagged: 0, costUsd: 0 };
  for (const { roomId } of rooms) {
    if (!context.shouldContinue() || context.msRemaining() < SWEEP_RESERVE_MS)
      break;
    const outcome = await tagRoomChatSignals(roomId, {
      source: "sweep",
      evaluate: options.evaluate,
    });
    summary.claimed += outcome.claimed;
    summary.tagged += outcome.tagged;
    summary.costUsd += outcome.costUsd;
  }
  if (rooms.length > 0) {
    const log = createCoreLogger({ operation: "chat_message_signals_sweep" });
    log.set({ chatSignalsSweep: summary });
    log.emit();
  }
}

function report(error: unknown, extra: Record<string, string>): void {
  console.error("Chat message signals failed", error);
  Sentry.captureException(error, {
    tags: { context: "chat_message_signals" },
    extra,
  });
}
