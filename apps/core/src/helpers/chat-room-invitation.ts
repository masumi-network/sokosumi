import type { Prisma } from "@sokosumi/database";

import { TIME } from "@/config/constants";
import { badRequest } from "@/helpers/error";
import {
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

export function invitationExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_MS);
}
