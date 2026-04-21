import prisma from "@/lib/db/prisma";

export const ACTIVE_UI_STREAM_ID_METADATA_KEY = "active_ui_stream_id" as const;

export async function clearActiveUiStreamIdInMetadata(params: {
  conversationId: string;
  userId: string;
}): Promise<void> {
  const { conversationId, userId } = params;
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ metadata: unknown }>>`
      SELECT "metadata" FROM "conversation"
      WHERE "id" = ${conversationId} AND "userId" = ${userId} AND "archivedAt" IS NULL
      FOR UPDATE
    `;
    if (rows.length === 0) {
      return;
    }
    const meta = (rows[0]!.metadata as Record<string, unknown>) ?? {};
    if (meta[ACTIVE_UI_STREAM_ID_METADATA_KEY] == null) {
      return;
    }
    const next = { ...meta };
    delete next[ACTIVE_UI_STREAM_ID_METADATA_KEY];
    await tx.conversation.update({
      where: { id: conversationId },
      data: { metadata: next },
    });
  });
}

export async function setActiveUiStreamIdInMetadata(params: {
  conversationId: string;
  userId: string;
  streamId: string;
}): Promise<void> {
  const { conversationId, userId, streamId } = params;
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ metadata: unknown }>>`
      SELECT "metadata" FROM "conversation"
      WHERE "id" = ${conversationId} AND "userId" = ${userId} AND "archivedAt" IS NULL
      FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new Error("Conversation not found");
    }
    const meta = (rows[0]!.metadata as Record<string, unknown>) ?? {};
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        metadata: {
          ...meta,
          [ACTIVE_UI_STREAM_ID_METADATA_KEY]: streamId,
        },
      },
    });
  });
}

export function readActiveUiStreamIdFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null;
  const v = metadata[ACTIVE_UI_STREAM_ID_METADATA_KEY];
  return typeof v === "string" && v.length > 0 ? v : null;
}
