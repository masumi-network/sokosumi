import * as Sentry from "@sentry/node";
import { buildChatMessagePreview } from "@sokosumi/utils";
import { chatMentionRoomShape } from "@/helpers/chat-human-mentions";
import { emitChatMentionNotifications } from "@/helpers/chat-mention-notifications";
import {
  CHAT_SIGNAL_PUSH_THRESHOLD,
  CHAT_SIGNAL_THRESHOLD,
  type ChatSignalProbabilities,
  NEEDS_YOU_TAGS,
} from "@/lib/chat-signals/tags";
import prisma from "@/lib/db/prisma";
import {
  captureContactInteraction,
  inContactTransaction,
} from "@/services/contacts.service";

/** One message Jev just read, with what the effects below need. */
export interface TaggedChatMessage {
  messageId: string;
  authorUserId: string;
  probabilities: ChatSignalProbabilities;
  addressedUserIds: readonly string[];
  mentionedUserIds: readonly string[];
  sentAt: Date;
}

/** A tag read late (a sweep, a retry) is history, not news: no push for it. */
const FRESH_FOR_PUSH_MS = 30 * 60_000;
const INTERRUPTING_TAGS = [...NEEDS_YOU_TAGS, "urgent", "escalation"] as const;

/**
 * Who a message should interrupt: the people it asks something of, or the
 * people an urgent message is addressed to, when Jev is sure enough to push.
 * Someone @mentioned already had their notification when it was sent, and a
 * pair already notifies every message, so neither is told twice.
 */
export function chatSignalPushRecipients(
  message: TaggedChatMessage,
  now: Date,
): string[] {
  if (now.getTime() - message.sentAt.getTime() > FRESH_FOR_PUSH_MS) return [];
  const interrupts = INTERRUPTING_TAGS.some(
    (tag) => (message.probabilities[tag] ?? 0) >= CHAT_SIGNAL_PUSH_THRESHOLD,
  );
  if (!interrupts) return [];
  const mentioned = new Set(message.mentionedUserIds);
  return message.addressedUserIds.filter(
    (userId) => userId !== message.authorUserId && !mentioned.has(userId),
  );
}

/**
 * Tells each reader a message asks something of, through their mention
 * preferences: being asked by name is being mentioned, so the reader's say
 * over mentions (in app, push, email) is the say over this, and the one row
 * per message and reader keeps a later @mention from doubling it.
 */
export async function notifyChatSignalReaders(
  roomId: string,
  messages: readonly TaggedChatMessage[],
  now = new Date(),
): Promise<number> {
  const due = messages
    .map((message) => ({
      message,
      recipients: chatSignalPushRecipients(message, now),
    }))
    .filter(({ recipients }) => recipients.length > 0);
  if (due.length === 0) return 0;

  const room = await prisma.chatRoom.findUniqueOrThrow({
    where: { id: roomId },
    select: {
      name: true,
      kind: true,
      organizationId: true,
      userMembers: { select: { userId: true } },
      _count: { select: { coworkerMembers: true, sokoBotMembers: true } },
    },
  });
  const roomShape = chatMentionRoomShape({
    kind: room.kind,
    memberUserIds: room.userMembers.map((member) => member.userId),
    nonHumanMemberCount:
      room._count.coworkerMembers + room._count.sokoBotMembers,
  });
  if (roomShape === "pair") return 0;

  const bodies = await prisma.chatRoomMessage.findMany({
    where: { id: { in: due.map(({ message }) => message.messageId) } },
    select: { id: true, content: true, senderUser: { select: { name: true } } },
  });
  let notified = 0;
  for (const { message, recipients } of due) {
    const body = bodies.find((candidate) => candidate.id === message.messageId);
    if (!body) continue;
    await emitChatMentionNotifications({
      roomId,
      roomName: room.name,
      roomShape,
      organizationId: room.organizationId,
      messageId: message.messageId,
      content: body.content,
      authorUserId: message.authorUserId,
      authorName: body.senderUser?.name ?? "Someone",
      mentionedUserIds: recipients,
    });
    notified += recipients.length;
  }
  return notified;
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Logs an external room's conversation on the Contacts of the people from
 * outside: one interaction per person, room and day, and one of its own for
 * each message Jev read as an escalation, so the timeline shows it. The host
 * organization's workspace holds the contacts; a member of that organization
 * is the teammate who had the conversation.
 */
export async function captureExternalRoomContacts(
  roomId: string,
  messages: readonly TaggedChatMessage[],
): Promise<number> {
  if (messages.length === 0) return 0;
  const room = await prisma.chatRoom.findUniqueOrThrow({
    where: { id: roomId },
    select: {
      name: true,
      discoverability: true,
      organizationId: true,
      userMembers: {
        orderBy: { createdAt: "asc" },
        select: {
          userId: true,
          access: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (room.discoverability !== "external" || !room.organizationId) return 0;
  const workspace = await prisma.workspace.findUnique({
    where: { organizationId: room.organizationId },
    select: { id: true },
  });
  const guests = new Map(
    room.userMembers
      .filter((member) => member.access === "guest")
      .map((member) => [member.userId, member.user]),
  );
  const teammate = room.userMembers.find(
    (member) => member.access === "member",
  );
  if (!workspace || !teammate || guests.size === 0) return 0;

  const bodies = await prisma.chatRoomMessage.findMany({
    where: { id: { in: messages.map((message) => message.messageId) } },
    select: { id: true, content: true },
  });
  const actor = {
    workspaceId: workspace.id,
    userId: teammate.userId,
    sokoBotId: null,
  };
  let captured = 0;
  for (const message of messages) {
    const guest = guests.get(message.authorUserId);
    const escalation =
      (message.probabilities.escalation ?? 0) >= CHAT_SIGNAL_THRESHOLD;
    // A teammate's message names no one from outside to log it against,
    // unless it is the escalation everyone there should see.
    const people = guest
      ? [[message.authorUserId, guest] as const]
      : escalation
        ? [...guests.entries()]
        : [];
    for (const [guestId, person] of people) {
      if (!person.email) continue;
      const preview = buildChatMessagePreview(
        bodies.find((body) => body.id === message.messageId)?.content ?? "",
        new Map(),
      ).slice(0, 160);
      const interaction = escalation
        ? {
            occurredAt: message.sentAt.toISOString(),
            channel: "OTHER" as const,
            direction: guest ? ("IN" as const) : ("OUT" as const),
            summary: `Escalation in ${room.name}${preview ? `: ${preview}` : ""}`,
            sourceRef: `sokosumi-chat:${roomId}:${message.messageId}:${guestId}`,
          }
        : {
            occurredAt: message.sentAt.toISOString(),
            channel: "OTHER" as const,
            direction: "IN" as const,
            summary: `Chat in ${room.name}`,
            sourceRef: `sokosumi-chat:${roomId}:${guestId}:${dayOf(message.sentAt)}`,
          };
      try {
        const result = await inContactTransaction((tx) =>
          captureContactInteraction(tx, actor, {
            name: person.name,
            channels: [{ type: "EMAIL", value: person.email }],
            interaction,
            teammateUserId: teammate.userId,
          }),
        );
        if (result.interactionCreated) captured += 1;
      } catch (error) {
        Sentry.captureException(error, {
          tags: { context: "chat_signal_contacts" },
          extra: { roomId, messageId: message.messageId },
        });
      }
    }
  }
  return captured;
}
