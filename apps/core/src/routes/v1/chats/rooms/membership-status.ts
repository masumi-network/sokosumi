import type { Prisma } from "@sokosumi/database";

import { badRequest } from "@/helpers/error";

import { chatRoomMessageInclude } from "./helpers";

type ChatRoomMessageWithInclude = Prisma.ChatRoomMessageGetPayload<{
  include: typeof chatRoomMessageInclude;
}>;

/** The status row one membership change leaves in its room. */
export type ChannelMembershipStatusMessage = ChatRoomMessageWithInclude;

export type MembershipSubject =
  | { type: "user"; id: string; name: string }
  | { type: "coworker"; id: string; name: string }
  | { type: "sokoBot"; id: string; name: string };

/** Type alias, not an interface: it is written into a Prisma `Json` column. */
export type MembershipActor = { id: string; name: string };

export type ChannelMembershipChange = {
  action: "joined" | "left";
  subject: MembershipSubject;
  /**
   * Who added or removed the subject. Absent when the subject joined or left
   * on their own, so a removal never reads as leaving.
   */
  actor?: MembershipActor;
};

export type GroupNameChange = {
  action: "named" | "cleared";
  /** The new Group name; null when cleared. */
  name: string | null;
  actor: MembershipActor;
};

export interface RecordChannelMembershipStatusArgs {
  roomId: string;
  roomKind: string;
  changes: readonly ChannelMembershipChange[];
}

function membershipStatusContent(change: ChannelMembershipChange): string {
  const { actor, subject } = change;
  if (actor) {
    return change.action === "joined"
      ? `${actor.name} added ${subject.name}`
      : `${actor.name} removed ${subject.name}`;
  }
  return change.action === "joined"
    ? `${subject.name} joined`
    : `${subject.name} left`;
}

function membershipMetadata(
  change: ChannelMembershipChange,
): Prisma.InputJsonObject {
  return {
    membership: {
      action: change.action,
      subject: {
        type: change.subject.type,
        id: change.subject.id,
        name: change.subject.name,
      },
      ...(change.actor
        ? { actor: { id: change.actor.id, name: change.actor.name } }
        : {}),
    },
  };
}

/**
 * Persist one ChatRoomMessage per channel membership change in `tx`.
 * No-ops for non-channels and empty change lists. Callers publish after commit.
 *
 * Bumps the room's `updatedAt` with the messages: these rows count toward
 * `unreadCount`, and the web read overlay drops only when the room row's
 * `updatedAt` moves past the mark-read snapshot. Without the bump the sidebar
 * repaints the room read and its unread never bolds.
 */
export async function recordChannelMembershipStatus(
  tx: Prisma.TransactionClient,
  args: RecordChannelMembershipStatusArgs,
): Promise<ChatRoomMessageWithInclude[]> {
  if (args.roomKind !== "channel" || args.changes.length === 0) {
    return [];
  }

  const messages: ChatRoomMessageWithInclude[] = [];
  for (const change of args.changes) {
    const message = await tx.chatRoomMessage.create({
      data: {
        roomId: args.roomId,
        content: membershipStatusContent(change),
        senderUserId: null,
        senderCoworkerId: null,
        metadata: membershipMetadata(change),
      },
      include: chatRoomMessageInclude,
    });
    messages.push(message);
  }
  await tx.chatRoom.update({
    where: { id: args.roomId },
    data: { updatedAt: new Date() },
  });
  return messages;
}

function groupNameChangeContent(change: GroupNameChange): string {
  return change.action === "named"
    ? `${change.actor.name} named the group ${change.name}`
    : `${change.actor.name} removed the group name`;
}

/**
 * Persist the one status row a Group name change leaves in its room, in `tx`.
 * No sender, like the membership rows; unread counts leave it out, so a
 * rename never marks the room unread. Bumps the room's `updatedAt` like
 * `recordChannelMembershipStatus`, so the sidebar sorts it as activity.
 * Callers publish after commit.
 */
export async function recordGroupNameChange(
  tx: Prisma.TransactionClient,
  args: { roomId: string; change: GroupNameChange },
): Promise<ChatRoomMessageWithInclude> {
  const { change } = args;
  const message = await tx.chatRoomMessage.create({
    data: {
      roomId: args.roomId,
      content: groupNameChangeContent(change),
      senderUserId: null,
      senderCoworkerId: null,
      metadata: { groupNameChange: change },
    },
    include: chatRoomMessageInclude,
  });
  await tx.chatRoom.update({
    where: { id: args.roomId },
    data: { updatedAt: new Date() },
  });
  return message;
}

export function readGroupNameChangeFromMetadata(
  metadata: Record<string, unknown> | null,
): GroupNameChange | null {
  const raw = metadata?.groupNameChange;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const actor = candidate.actor as Record<string, unknown> | null | undefined;
  if (
    !actor ||
    typeof actor !== "object" ||
    typeof actor.id !== "string" ||
    typeof actor.name !== "string"
  ) {
    return null;
  }
  if (candidate.action === "named" && typeof candidate.name === "string") {
    return {
      action: "named",
      name: candidate.name,
      actor: { id: actor.id, name: actor.name },
    };
  }
  if (candidate.action === "cleared") {
    return {
      action: "cleared",
      name: null,
      actor: { id: actor.id, name: actor.name },
    };
  }
  return null;
}

export function readMembershipFromMetadata(
  metadata: Record<string, unknown> | null,
): ChannelMembershipChange | null {
  const raw = metadata?.membership;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.action !== "joined" && candidate.action !== "left") {
    return null;
  }
  const subjectRaw = candidate.subject;
  if (
    !subjectRaw ||
    typeof subjectRaw !== "object" ||
    Array.isArray(subjectRaw)
  ) {
    return null;
  }
  const subject = subjectRaw as Record<string, unknown>;
  const subjectType =
    subject.type === "orchestrator" ? "sokoBot" : subject.type;
  if (
    (subjectType !== "user" &&
      subjectType !== "coworker" &&
      subjectType !== "sokoBot") ||
    typeof subject.id !== "string" ||
    typeof subject.name !== "string"
  ) {
    return null;
  }
  const actor = candidate.actor as Record<string, unknown> | null | undefined;
  return {
    action: candidate.action,
    subject: {
      type: subjectType,
      id: subject.id,
      name: subject.name,
    },
    ...(actor && typeof actor.id === "string" && typeof actor.name === "string"
      ? { actor: { id: actor.id, name: actor.name } }
      : {}),
  };
}

/** React / edit / delete / quote targets must be ordinary composer messages. */
export function assertChatRoomContentMessage(metadata: unknown): void {
  const record =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : null;
  if (readMembershipFromMetadata(record) != null) {
    throw badRequest("Cannot modify a membership status message");
  }
  if (readGroupNameChangeFromMetadata(record) != null) {
    throw badRequest("Cannot modify a group name status message");
  }
}
