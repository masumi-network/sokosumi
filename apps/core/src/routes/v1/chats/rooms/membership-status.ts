import type { Prisma } from "@sokosumi/database";

import { badRequest } from "@/helpers/error";

import { chatRoomMessageInclude } from "./helpers";

type ChatRoomMessageWithInclude = Prisma.ChatRoomMessageGetPayload<{
  include: typeof chatRoomMessageInclude;
}>;

export type MembershipSubject =
  | { type: "user"; id: string; name: string }
  | { type: "coworker"; id: string; name: string };

export type ChannelMembershipChange = {
  action: "joined" | "left";
  subject: MembershipSubject;
};

export interface ChannelRosterSnapshot {
  users: ReadonlyArray<{ id: string; name: string }>;
  coworkers: ReadonlyArray<{ id: string; name: string }>;
}

export interface RecordChannelMembershipStatusArgs {
  roomId: string;
  roomKind: string;
  changes: readonly ChannelMembershipChange[];
}

/**
 * Pure set-diff of channel roster snapshots. Adds → joined, removes → left.
 * Stable order: user left, coworker left, user joined, coworker joined.
 */
export function diffChannelMembershipRoster(args: {
  prior: ChannelRosterSnapshot;
  next: ChannelRosterSnapshot;
}): ChannelMembershipChange[] {
  const nextUserIds = new Set(args.next.users.map((user) => user.id));
  const priorUserIds = new Set(args.prior.users.map((user) => user.id));
  const nextCoworkerIds = new Set(
    args.next.coworkers.map((coworker) => coworker.id),
  );
  const priorCoworkerIds = new Set(
    args.prior.coworkers.map((coworker) => coworker.id),
  );

  const changes: ChannelMembershipChange[] = [];

  for (const user of args.prior.users) {
    if (!nextUserIds.has(user.id)) {
      changes.push({
        action: "left",
        subject: { type: "user", id: user.id, name: user.name },
      });
    }
  }

  for (const coworker of args.prior.coworkers) {
    if (!nextCoworkerIds.has(coworker.id)) {
      changes.push({
        action: "left",
        subject: { type: "coworker", id: coworker.id, name: coworker.name },
      });
    }
  }

  for (const user of args.next.users) {
    if (!priorUserIds.has(user.id)) {
      changes.push({
        action: "joined",
        subject: { type: "user", id: user.id, name: user.name },
      });
    }
  }

  for (const coworker of args.next.coworkers) {
    if (!priorCoworkerIds.has(coworker.id)) {
      changes.push({
        action: "joined",
        subject: { type: "coworker", id: coworker.id, name: coworker.name },
      });
    }
  }

  return changes;
}

function membershipStatusContent(change: ChannelMembershipChange): string {
  return change.action === "joined"
    ? `${change.subject.name} joined`
    : `${change.subject.name} left`;
}

function membershipMetadata(
  change: ChannelMembershipChange,
): Record<string, unknown> {
  return {
    membership: {
      action: change.action,
      subject: {
        type: change.subject.type,
        id: change.subject.id,
        name: change.subject.name,
      },
    },
  };
}

/**
 * Persist one ChatRoomMessage per channel membership change in `tx`.
 * No-ops for non-channels and empty change lists. Callers publish after commit.
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
  return messages;
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
  if (
    (subject.type !== "user" && subject.type !== "coworker") ||
    typeof subject.id !== "string" ||
    typeof subject.name !== "string"
  ) {
    return null;
  }
  return {
    action: candidate.action,
    subject: {
      type: subject.type,
      id: subject.id,
      name: subject.name,
    },
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
}
