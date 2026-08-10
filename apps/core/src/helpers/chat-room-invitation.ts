import type { Prisma } from "@sokosumi/database";

import { LIMITS, TIME } from "@/config/constants";
import { badRequest, tooManyRequests } from "@/helpers/error";
import { CHAT_ROOM_ACCESS } from "@/schemas/chat-room.schema";
import {
  CHAT_ROOM_INVITATION_STATUS,
  type ChatRoomInvitation,
  chatRoomInvitationSchema,
} from "@/schemas/chat-room-invitation.schema";

/** Room invitation TTL matches org invitation expiry (7 days). */
export const INVITE_TTL_MS = TIME.INVITATION_EXPIRES * 1000;

/**
 * Normalize invitation emails for storage and lookup: trim + lowercase.
 * Partial unique index on pending invites assumes case-normalized emails.
 */
export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface MapChatRoomInvitationInput {
  id: string;
  roomId: string;
  roomName: string;
  organizationId: string;
  organizationName: string;
  email: string;
  status: string;
  inviter: { id: string; name: string };
  expiresAt: Date;
  createdAt: Date;
}

/** Invitation row fields shared by Prisma selects used in invitation routes. */
export interface ChatRoomInvitationRecord {
  id: string;
  email: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  inviter: { id: string; name: string };
}

/** Room/org context needed to build the public invitation DTO. */
export interface ChatRoomInvitationRoomContext {
  id: string;
  name?: string | null;
  organizationId: string;
  organizationName?: string | null;
}

export function mapChatRoomInvitation(
  input: MapChatRoomInvitationInput,
): ChatRoomInvitation {
  return chatRoomInvitationSchema.parse({
    id: input.id,
    roomId: input.roomId,
    roomName: input.roomName,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    email: input.email,
    status: input.status,
    inviter: {
      id: input.inviter.id,
      name: input.inviter.name,
    },
    expiresAt: input.expiresAt,
    createdAt: input.createdAt,
  });
}

/**
 * Map a Prisma invitation record + room/org context to the public DTO.
 * Prefer this over hand-assembling mapChatRoomInvitation fields in routes.
 */
export function mapChatRoomInvitationFromRecord(
  invitation: ChatRoomInvitationRecord,
  room: ChatRoomInvitationRoomContext,
  options?: { status?: string },
): ChatRoomInvitation {
  return mapChatRoomInvitation({
    id: invitation.id,
    roomId: room.id,
    roomName: room.name ?? "",
    organizationId: room.organizationId,
    organizationName: room.organizationName ?? "",
    email: invitation.email,
    status: options?.status ?? invitation.status,
    inviter: {
      id: invitation.inviter.id,
      name: invitation.inviter.name,
    },
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  });
}

/**
 * Reject invites to emails that already belong to a host-org Member.
 * Those users should self-join the external channel as members.
 */
export async function assertInviteeNotHostOrgMember(
  organizationId: string,
  email: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const hostMember = await tx.member.findFirst({
    where: {
      organizationId,
      user: {
        email: { equals: email, mode: "insensitive" },
      },
    },
    select: { id: true },
  });

  if (hostMember) {
    throw badRequest(
      "User is already an organization member; they can join the channel directly.",
    );
  }
}

/**
 * Reject invites when the email already has guest (or any) membership on the room.
 */
export async function assertInviteeNotRoomMember(
  roomId: string,
  email: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const existingMember = await tx.chatRoomUserMember.findFirst({
    where: {
      roomId,
      user: {
        email: { equals: email, mode: "insensitive" },
      },
    },
    select: { id: true, access: true },
  });

  if (!existingMember) {
    return;
  }

  if (existingMember.access === CHAT_ROOM_ACCESS.GUEST) {
    throw badRequest("User is already a guest in this channel.");
  }

  throw badRequest("User is already a member of this channel.");
}

/**
 * Prisma `where` for pending invitations that have not yet expired.
 * Prefer this over bare `status: pending` so TTL-dead rows do not block
 * convert, rate limits, last-host leave, or host lists.
 */
export function livePendingInvitationWhere(
  roomId: string,
  now: Date = new Date(),
): Prisma.ChatRoomGuestInvitationWhereInput {
  return {
    roomId,
    status: CHAT_ROOM_INVITATION_STATUS.PENDING,
    expiresAt: { gt: now },
  };
}

/**
 * Mark past-due pending invites as expired (room-scoped or global).
 * Safe to call inside a transaction before count/create/list.
 */
export async function expireStalePendingInvitations(
  tx: Prisma.TransactionClient,
  options?: { roomId?: string; now?: Date },
): Promise<number> {
  const now = options?.now ?? new Date();
  const result = await tx.chatRoomGuestInvitation.updateMany({
    where: {
      status: CHAT_ROOM_INVITATION_STATUS.PENDING,
      expiresAt: { lte: now },
      ...(options?.roomId ? { roomId: options.roomId } : {}),
    },
    data: { status: CHAT_ROOM_INVITATION_STATUS.EXPIRED },
  });
  return result.count;
}

/**
 * Abuse caps for guest invites: live pending per room + creates per inviter/hour.
 * Call after {@link expireStalePendingInvitations} for the room (or under room lock).
 * Uses existing unique-pending uniqueness for exact email duplicates.
 */
export async function assertChatRoomInvitationRateLimits(
  roomId: string,
  inviterId: string,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<void> {
  const pendingCount = await tx.chatRoomGuestInvitation.count({
    where: livePendingInvitationWhere(roomId, now),
  });
  if (pendingCount >= LIMITS.CHAT_ROOM_GUEST_INVITATION_PENDING_LIMIT) {
    throw tooManyRequests(
      `This channel already has ${LIMITS.CHAT_ROOM_GUEST_INVITATION_PENDING_LIMIT} pending invitations. Revoke some before inviting more.`,
    );
  }

  const createWindowStart = new Date(now.getTime() - 60 * 60 * 1000);
  const recentCreateCount = await tx.chatRoomGuestInvitation.count({
    where: {
      inviterId,
      createdAt: { gte: createWindowStart },
    },
  });
  if (recentCreateCount >= LIMITS.CHAT_ROOM_GUEST_INVITATION_CREATE_PER_HOUR) {
    throw tooManyRequests(
      `You can create at most ${LIMITS.CHAT_ROOM_GUEST_INVITATION_CREATE_PER_HOUR} guest invitations per hour. Try again later.`,
    );
  }
}

export function invitationExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_MS);
}
