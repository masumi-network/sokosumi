import prisma from "@/lib/db/prisma";
import {
  CoworkerConversationError,
  createCoworkerConversation,
} from "@/routes/v1/chats/stream/coworker-conversation";

export interface EnsureCoworkerProviderConversationForRoomOptions {
  roomId: string;
  userId: string;
  organizationId: string | null;
  coworkerSlug: string;
  responsesApiBaseUrl: string;
}

/**
 * Creates or reuses the remote coworker Conversations API thread for a room,
 * persisting the id on `chatRoom.providerConversationId` (never on `conversation*`).
 */
export async function ensureCoworkerProviderConversationForRoom(
  options: EnsureCoworkerProviderConversationForRoomOptions,
): Promise<{ providerConversationId: string; justCreated: boolean }> {
  const existing = await prisma.chatRoom.findFirst({
    where: {
      id: options.roomId,
      archivedAt: null,
      userMembers: { some: { userId: options.userId } },
    },
    select: { providerConversationId: true },
  });
  const existingId = existing?.providerConversationId?.trim();
  if (existingId) {
    return { providerConversationId: existingId, justCreated: false };
  }

  const created = await createCoworkerConversation({
    responsesApiBaseUrl: options.responsesApiBaseUrl,
    sokosumiUserId: options.userId,
    sokosumiOrganizationId: options.organizationId,
    coworkerSlug: options.coworkerSlug,
    // Remote metadata correlation id — room id, not a conversation* row.
    sokosumiConversationId: options.roomId,
  });

  const updated = await prisma.chatRoom.updateMany({
    where: {
      id: options.roomId,
      providerConversationId: null,
      userMembers: { some: { userId: options.userId } },
    },
    data: { providerConversationId: created.id },
  });

  if (updated.count === 0) {
    const refetched = await prisma.chatRoom.findFirst({
      where: {
        id: options.roomId,
        archivedAt: null,
        userMembers: { some: { userId: options.userId } },
      },
      select: { providerConversationId: true },
    });
    const refetchedId = refetched?.providerConversationId?.trim();
    if (!refetchedId) {
      throw new CoworkerConversationError(
        "Could not persist coworker provider conversation id on room",
        503,
      );
    }
    return { providerConversationId: refetchedId, justCreated: false };
  }

  return { providerConversationId: created.id, justCreated: true };
}
