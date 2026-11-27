import {
  type ChatResultReference,
  SOKO_BOT_SEND_MESSAGE_MAX_WAIT_SECONDS,
} from "@sokosumi/soko-bot";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { createOrGetCoworkerQuestionRoom } from "@/lib/soko-bot/coworker-question-room";
import { directChatNeedle } from "@/lib/soko-bot/direct-chat-target";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { resolveMentionedSokoBotIds } from "@/routes/v1/chats/rooms/helpers";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import {
  composeHandoff,
  describeReply,
  guardPrivateData,
} from "./chat-message-handoff";
import { type RuntimeOperations } from "./operations";

/**
 * send_message: the bot names who it wants and Core picks the room, always
 * one a person can read, with the rules each older tool applied (ask_coworker,
 * open_direct_chat, post_chat): the owner's requests only, reply-where-asked
 * at any chain depth, the room's hourly backstop. The message goes out at
 * once, and an agent's answer comes back in the same call, so one turn can
 * hold a short exchange.
 */

/** Messages to one recipient in one conversation; then the bot reports. */
export const MAX_MESSAGES_PER_RECIPIENT = 4;
/** Messages in one conversation, to everyone together. */
export const MAX_MESSAGES_PER_CONVERSATION = 8;
const DEFAULT_WAIT_SECONDS = 75;
const POLL_MS = 3_000;

export type SokoBotRecipient =
  | { kind: "room"; roomId: string; name: string }
  | { kind: "coworker"; id: string; name: string; slug: string }
  | { kind: "assistant"; id: string; name: string; ownerName: string | null }
  | { kind: "person"; userId: string; name: string; email: string };

function same(left: string | null | undefined, right: string): boolean {
  return (left ?? "").trim().toLowerCase() === right.trim().toLowerCase();
}

function describe(recipient: SokoBotRecipient): string {
  switch (recipient.kind) {
    case "room":
      return `#${recipient.name} (room)`;
    case "coworker":
      return `${recipient.name} (Coworker)`;
    case "assistant":
      return recipient.ownerName
        ? `${recipient.name} (${recipient.ownerName}'s assistant)`
        : `${recipient.name} (shared assistant)`;
    case "person":
      return `${recipient.name} (person)`;
  }
}

async function organizationOf(workspaceId: string): Promise<string | null> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { organizationId: true },
  });
  return workspace?.organizationId ?? null;
}

/** Everyone the bot may message, as list_recipients and the resolver see them. */
async function directory(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  query?: string,
): Promise<SokoBotRecipient[]> {
  const { sokoBotId, workspaceId } = authorized.turn;
  const organizationId = await organizationOf(workspaceId);
  const [coworkers, people, assistants, rooms] = await Promise.all([
    runtime.findCoworkers(authorized, query),
    runtime.findTeammates(workspaceId, query),
    prisma.sokoBot.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        id: { not: sokoBotId },
        projectId: null,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" as const } },
                {
                  user: {
                    name: { contains: query, mode: "insensitive" as const },
                  },
                },
              ],
            }
          : {}),
      },
      take: 20,
      select: {
        id: true,
        name: true,
        userId: true,
        user: { select: { name: true } },
      },
    }),
    organizationId
      ? prisma.chatRoom.findMany({
          where: {
            organizationId,
            archivedAt: null,
            kind: { not: "direct" },
            sokoBotMembers: { some: { sokoBotId } },
            ...(query
              ? { name: { contains: query, mode: "insensitive" as const } }
              : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: 20,
          select: { id: true, name: true, groupName: true },
        })
      : [],
  ]);
  return [
    ...people
      .filter((person) => person.userId !== authorized.turn.actingUserId)
      .map((person) => ({
        kind: "person" as const,
        userId: person.userId,
        name: person.name ?? person.email,
        email: person.email,
      })),
    ...coworkers
      .filter((coworker) => coworker.capabilities.includes("chat"))
      .map((coworker) => ({
        kind: "coworker" as const,
        id: coworker.id,
        name: coworker.name,
        slug: coworker.slug,
      })),
    ...assistants.map((bot) => ({
      kind: "assistant" as const,
      id: bot.id,
      name: sokoBotDisplayName({ name: bot.name }),
      ownerName: bot.userId ? (bot.user?.name ?? null) : null,
    })),
    ...rooms.map((room) => ({
      kind: "room" as const,
      roomId: room.id,
      name: room.groupName ?? room.name,
    })),
  ];
}

export async function listRecipients(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  query?: string,
) {
  const everyone = await directory(runtime, authorized, query);
  const answers = await lastAnswers(runtime, authorized);
  return {
    recipients: everyone.map((recipient) => ({
      ...(answers.get(recipientKey(recipient))
        ? { lastAnswer: answers.get(recipientKey(recipient)) }
        : {}),
      to:
        recipient.kind === "room"
          ? `#${recipient.name}`
          : recipient.kind === "person"
            ? recipient.email
            : recipient.name,
      who: describe(recipient),
      ...(recipient.kind === "coworker"
        ? { handle: `@${recipient.slug}` }
        : {}),
    })),
  };
}

function recipientKey(recipient: SokoBotRecipient): string {
  switch (recipient.kind) {
    case "room":
      return `room:${recipient.roomId}`;
    case "person":
      return `person:${recipient.userId}`;
    default:
      return `${recipient.kind}:${recipient.id}`;
  }
}

function matching(everyone: SokoBotRecipient[], to: string) {
  const needle = directChatNeedle(to);
  const room = needle.startsWith("#") ? needle.slice(1).trim() : null;
  const assistantOf = needle.match(
    /^(.+?)(?:'s|’s|s)? (?:assistant|soko bot|bot)$/i,
  )?.[1];
  return everyone.filter((recipient) => {
    if (room !== null)
      return recipient.kind === "room" && same(recipient.name, room);
    switch (recipient.kind) {
      case "room":
        return same(recipient.name, needle);
      case "coworker":
        return same(recipient.name, needle) || same(recipient.slug, needle);
      case "assistant":
        return (
          same(recipient.name, needle) ||
          (!!assistantOf &&
            !!recipient.ownerName &&
            (same(recipient.ownerName, assistantOf) ||
              same(recipient.ownerName.split(" ")[0], assistantOf)))
        );
      case "person":
        return (
          same(recipient.email, needle) ||
          same(recipient.name, needle) ||
          same(recipient.name.split(" ")[0], needle)
        );
    }
  });
}

/** The words of `to` worth searching the directory for. */
function searchWords(to: string): string {
  return directChatNeedle(to)
    .replace(/^#/, "")
    .replace(/(?:'s|’s)? (?:assistant|soko bot|bot)$/i, "")
    .trim();
}

/** "Juno", "@mira", "Hannah's assistant", "hannah@…", "#Launch team". */
export async function resolveRecipient(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  to: string,
): Promise<SokoBotRecipient> {
  const found = await directory(runtime, authorized, searchWords(to));
  const matches = matching(found, to);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1)
    throw new SokoBotRuntimeValidationError(
      `"${to}" could be ${matches.map(describe).join(", or ")}. Use the exact name, or ask the person you work for which one.`,
    );
  const everyone = await directory(runtime, authorized);
  throw new SokoBotRuntimeValidationError(
    `Nobody here is called "${to}". You can message: ${
      everyone.slice(0, 30).map(describe).join("; ") || "nobody yet"
    }.`,
  );
}

/**
 * Why open_direct_chat found nobody, and what to do instead: a Coworker,
 * assistant or room by that name is reached with send_message, and anyone
 * else gets the members it could have meant.
 */
export async function unknownPersonRefusal(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  person: string,
): Promise<string> {
  const found = matching(
    await directory(runtime, authorized, searchWords(person)),
    person,
  ).filter((recipient) => recipient.kind !== "person");
  // The directory is the bot's: a room is named only to someone in it.
  const visibleRooms = await roomsVisibleTo(
    authorized.turn.askedByUserId ?? authorized.turn.requestedByUserId,
    found.flatMap((recipient) =>
      recipient.kind === "room" ? [recipient.roomId] : [],
    ),
  );
  const notPeople = found.filter(
    (recipient) =>
      recipient.kind !== "room" || visibleRooms.has(recipient.roomId),
  );
  // With two candidates, any tool would pick one of them for the owner.
  if (notPeople.length > 1)
    return `"${person}" is not a member of this organization; it could be ${notPeople.map(describe).join(", or ")}. Ask the owner which one they mean.`;
  if (notPeople.length === 1)
    return `"${person}" is ${describe(notPeople[0]!)}, not a member of this organization. ${
      mayMessageOthers(authorized)
        ? reachInstead(notPeople[0]!.kind, authorized.grant.capabilities)
        : "Tell the person who asked that you would reach it there."
    }`;
  const people = (await directory(runtime, authorized)).filter(
    (recipient) => recipient.kind === "person",
  );
  return `No member of this organization matches "${person}". ${
    people.length
      ? `Members: ${people
          .slice(0, 30)
          .map((p) => p.name)
          .join("; ")}.`
      : "There are no other members."
  } If it is none of them, ask the owner who they mean.`;
}

/** Who may have the bot message others: sendMessage's own rule. */
function mayMessageOthers(authorized: AuthorizedSokoBotRuntime): boolean {
  return (
    authorized.askedByKind !== "ASSISTANT" &&
    (Boolean(authorized.reader.sharedScope) ||
      authorized.askedByKind === "OWNER")
  );
}

/** The rooms among `roomIds` the person asking is in; none for nobody. */
async function roomsVisibleTo(
  userId: string | null | undefined,
  roomIds: string[],
): Promise<Set<string>> {
  if (!userId || roomIds.length === 0) return new Set();
  const rooms = await prisma.chatRoom.findMany({
    where: { id: { in: roomIds }, userMembers: { some: { userId } } },
    select: { id: true },
  });
  return new Set(rooms.map((room) => room.id));
}

/** How to reach a recipient that is not a person, with a tool this turn has. */
function reachInstead(
  kind: SokoBotRecipient["kind"],
  tools: readonly string[],
): string {
  if (tools.includes("send_message"))
    return "Write to it with send_message instead.";
  if (kind === "coworker" && tools.includes("ask_coworker"))
    return "Ask it with ask_coworker instead.";
  if (kind === "room" && tools.includes("post_chat"))
    return "Post there with post_chat instead.";
  return "Tell the owner you would reach it there.";
}

const ANSWER_DAYS = 30;

/** The latest answer each recipient gave the bot in the last 30 days, so it does not ask again. */
async function lastAnswers(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
) {
  const calls = await prisma.sokoBotToolCall.findMany({
    where: {
      capability: "send_message",
      status: "COMPLETED",
      createdAt: { gte: new Date(Date.now() - ANSWER_DAYS * 24 * 60 * 60_000) },
      turn: { sokoBotId: authorized.turn.sokoBotId },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { input: true, result: true, createdAt: true },
  });
  const answers = new Map<
    string,
    { date: string; asked: string; answer: string }
  >();
  for (const call of calls) {
    const input = call.input as { to?: unknown; message?: unknown } | null;
    const reply = (call.result as { reply?: unknown } | null)?.reply;
    if (typeof input?.to !== "string" || typeof reply !== "string") continue;
    const matches = matching(
      await directory(runtime, authorized, searchWords(input.to)),
      input.to,
    );
    if (matches.length !== 1) continue;
    const key = recipientKey(matches[0]!);
    if (answers.has(key)) continue;
    answers.set(key, {
      date: call.createdAt.toISOString().slice(0, 10),
      asked: String(input.message ?? "").slice(0, 200),
      answer: reply.slice(0, 600),
    });
  }
  return answers;
}

/** The conversation a turn belongs to: the turn that was asked and its follow-ups. */
async function conversationTurnIds(turnId: string): Promise<string[]> {
  const { watchOriginTurnId } = await import(
    "@/services/soko-bot-watches.service"
  );
  const origin = await watchOriginTurnId(turnId);
  const children = await prisma.sokoBotTurn.findMany({
    where: { parentTurnId: origin },
    select: { id: true },
  });
  return [origin, ...children.map((child) => child.id)];
}

/** What the bot already sent in this conversation: in all, and to `recipient`. */
async function messagesSent(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  turnIds: string[],
  recipient: SokoBotRecipient,
) {
  const calls = await prisma.sokoBotToolCall.findMany({
    where: {
      turnId: { in: turnIds },
      capability: "send_message",
      status: "COMPLETED",
    },
    select: { input: true },
  });
  const key = recipientKey(recipient);
  const earlier = [
    ...new Set(
      calls.flatMap((call) => {
        const to = (call.input as { to?: unknown } | null)?.to;
        return typeof to === "string" ? [to] : [];
      }),
    ),
  ];
  const sameRecipient = new Set<string>();
  for (const to of earlier) {
    const found = await directory(runtime, authorized, searchWords(to));
    const matches = matching(found, to);
    if (matches.length === 1 && recipientKey(matches[0]!) === key)
      sameRecipient.add(to);
  }
  return {
    total: calls.length,
    toThem: calls.filter((call) => {
      const to = (call.input as { to?: unknown } | null)?.to;
      return typeof to === "string" && sameRecipient.has(to);
    }).length,
  };
}

/** A room both assistants are in with the asking person, or a new private one. */
async function assistantRoom(
  authorized: AuthorizedSokoBotRuntime,
  recipient: Extract<SokoBotRecipient, { kind: "assistant" }>,
  organizationId: string,
  memberUserId: string,
) {
  const shared = await prisma.chatRoom.findFirst({
    where: {
      organizationId,
      archivedAt: null,
      kind: { not: "direct" },
      userMembers: { some: { userId: memberUserId } },
      AND: [
        { sokoBotMembers: { some: { sokoBotId: authorized.turn.sokoBotId } } },
        { sokoBotMembers: { some: { sokoBotId: recipient.id } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true },
  });
  return shared ? { ...shared, created: false } : null;
}

async function postToRecipient(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  recipient: SokoBotRecipient,
  input: {
    message: string;
    toolCallId: string;
    resultReferences?: ChatResultReference[];
  },
): Promise<{ roomId: string; messageId: string }> {
  const via = (result: Record<string, unknown>) => ({
    capability: "send_message" as const,
    result: { to: describe(recipient), ...result },
  });
  switch (recipient.kind) {
    case "room":
      return runtime.postChat(authorized, {
        roomId: recipient.roomId,
        content: input.message,
        toolCallId: input.toolCallId,
        resultReferences: input.resultReferences,
        via: via({ name: recipient.name }),
      });
    case "person":
      return runtime.openDirectChat(authorized, {
        person: recipient.email,
        message: input.message,
        toolCallId: input.toolCallId,
        capability: "send_message",
      });
    case "coworker":
      return runtime.askCoworker(authorized, {
        coworkerIds: [recipient.id],
        question: input.message,
        toolCallId: input.toolCallId,
        capability: "send_message",
      });
    case "assistant": {
      const memberUserId = authorized.turn.actingUserId;
      const organizationId = await organizationOf(authorized.turn.workspaceId);
      if (!memberUserId || !organizationId)
        throw new SokoBotRuntimeValidationError(
          "Talking to another assistant needs an organization workspace.",
        );
      const handle = `@${recipient.name}`;
      const content =
        resolveMentionedSokoBotIds({
          content: input.message,
          roomSokoBots: [{ id: recipient.id, name: recipient.name }],
        }).length > 0
          ? input.message
          : `${handle} ${input.message}`;
      const existing = await assistantRoom(
        authorized,
        recipient,
        organizationId,
        memberUserId,
      );
      return serializableTransaction(async (tx) => {
        const room =
          existing ??
          (await createOrGetCoworkerQuestionRoom(tx, {
            organizationId,
            memberUserId,
            sokoBotId: authorized.turn.sokoBotId,
            coworkers: [],
            assistants: [{ id: recipient.id, name: recipient.name }],
            discoverability: authorized.reader.sharedScope
              ? "public"
              : "private",
          }));
        return runtime.postChat(
          authorized,
          {
            roomId: room.id,
            content,
            toolCallId: input.toolCallId,
            via: via({ name: room.name, created: room.created }),
          },
          tx,
        );
      }, "Messaging the assistant collided with another operation");
    }
  }
}

/** Publishes the message now, rather than when the turn ends, so they can answer in it. */
async function deliverNow(turnId: string, toolCallId: string) {
  const effect = await prisma.sokoBotEffectOutbox.findFirst({
    where: { purpose: "CHAT_MESSAGE", receipt: { turnId, toolCallId } },
    select: { id: true },
  });
  if (!effect) return;
  const { deliverSokoBotEffect } = await import(
    "@/services/soko-bot-effect-outbox.service"
  );
  await deliverSokoBotEffect(effect.id);
}

/**
 * The receipt was written when the message went out; the answer came after.
 * Kept on it, so the answer's links count as sources and a later turn can
 * read what they said.
 */
async function recordReply(
  turnId: string,
  toolCallId: string,
  extra: Record<string, unknown>,
) {
  const where = { turnId_toolCallId: { turnId, toolCallId } };
  const row = await prisma.sokoBotToolCall.findUnique({
    where,
    select: { result: true },
  });
  const base =
    row?.result && typeof row.result === "object" && !Array.isArray(row.result)
      ? row.result
      : {};
  await prisma.sokoBotToolCall.update({
    where,
    data: { result: persistedToolResult({ ...base, ...extra }) },
  });
}

export async function sendMessage(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: {
    to: string;
    message: string;
    waitSeconds?: number;
    then?: string;
    resultReferences?: ChatResultReference[];
    request?: {
      goal: string;
      deliverable?: string;
      deadline?: string;
      context?: string;
    };
    taskId?: string;
    projectId?: string;
    toolCallId: string;
  },
) {
  const startedAt = Date.now();
  if (authorized.turn.chainDepth > 0)
    throw new SokoBotRuntimeAuthorizationError(
      "Another assistant asked you: just answer. Your answer is posted for you where you were asked.",
    );
  if (
    authorized.askedByKind === "ASSISTANT" ||
    (!authorized.reader.sharedScope && authorized.askedByKind !== "OWNER")
  )
    throw new SokoBotRuntimeAuthorizationError(
      "Messaging others is for the requests of the person you work for. Say who you would ask and what.",
    );
  const recipient = await resolveRecipient(runtime, authorized, input.to);
  if (recipient.kind === "person" || recipient.kind === "room") {
    const { isTaintBlocked } = await import("@/lib/soko-bot/turn-loop");
    if (await isTaintBlocked(authorized.turn.id, "post_chat"))
      throw new SokoBotRuntimeAuthorizationError(
        "This turn read the web or ran a command, so it cannot write to people or rooms. Show the owner the message and ask; their reply starts a turn that can send it. Coworkers and assistants you may still ask.",
      );
  }
  const conversation = await conversationTurnIds(authorized.turn.id);
  const sent = await messagesSent(runtime, authorized, conversation, recipient);
  if (sent.total >= MAX_MESSAGES_PER_CONVERSATION)
    throw new SokoBotRuntimeValidationError(
      `You have sent ${sent.total} messages in this conversation. Stop here and report to the person you work for what you have and what is still open.`,
    );
  if (sent.toThem >= MAX_MESSAGES_PER_RECIPIENT)
    throw new SokoBotRuntimeValidationError(
      `You have sent ${describe(recipient)} ${sent.toThem} messages in this conversation. Stop and report what you have and what is still open.`,
    );
  const toThem = sent.toThem + 1;
  const { message, handoff } = await composeHandoff(authorized, input);
  const origin = await prisma.sokoBotTurn.findUnique({
    where: { id: conversation[0] },
    select: { userMessage: true },
  });
  await guardPrivateData({
    turnIds: conversation,
    ownerRequest: origin?.userMessage ?? "",
    message,
  });
  const posted = await postToRecipient(runtime, authorized, recipient, {
    ...input,
    message,
  });
  await deliverNow(authorized.turn.id, input.toolCallId).catch(() => undefined);
  const result = {
    ...posted,
    to: describe(recipient),
    messagesToThem: toThem,
    ...(toThem >= MAX_MESSAGES_PER_RECIPIENT
      ? {
          last: `That was your last message to them in this conversation (${MAX_MESSAGES_PER_RECIPIENT}). Report what you have.`,
        }
      : {}),
  };
  const agent = recipient.kind === "coworker" || recipient.kind === "assistant";
  const askedAt = new Date();
  const { chatReplyOutcome, registerWatch } = await import(
    "@/services/soko-bot-watches.service"
  );
  const waitMs =
    1_000 *
    Math.min(
      agent ? (input.waitSeconds ?? DEFAULT_WAIT_SECONDS) : 0,
      SOKO_BOT_SEND_MESSAGE_MAX_WAIT_SECONDS,
    );
  const watch = {
    targetId: posted.roomId,
    sokoBotId: authorized.turn.sokoBotId,
    createdAt: askedAt,
  };
  while (waitMs > 0 && Date.now() - startedAt < waitMs) {
    const reply = await chatReplyOutcome(watch);
    if (reply) {
      const answer = {
        reply,
        ...(handoff ? await describeReply(reply) : {}),
      };
      await recordReply(authorized.turn.id, input.toolCallId, answer);
      return { ...result, ...answer };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  if (!input.then)
    return {
      ...result,
      waiting: false,
      note: agent
        ? "No answer yet, and you gave no `then`, so nothing will wake you. Tell the person you work for that you asked and that the answer will be in that room."
        : "Sent. A person answers later: give `then` next time so Core wakes you with their answer.",
    };
  const waiting = await registerWatch(authorized, {
    kind: "chat_reply",
    id: posted.roomId,
    then: input.then,
  });
  return {
    ...result,
    ...waiting,
    note: "No answer yet. Core wakes you with everything they said once they have finished. Finish any independent steps the owner asked for first; once nothing else can proceed, end your turn and say in one sentence who you asked.",
  };
}
