import type { Prisma } from "@sokosumi/database";

export async function failOpenChatRoomMentions(
  params: {
    where: Prisma.ChatRoomMentionWhereInput;
    error: string;
  },
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const where: Prisma.ChatRoomMentionWhereInput = {
    ...params.where,
    status: { in: ["pending", "sent"] },
  };
  const mentions = await tx.chatRoomMention.findMany({
    where,
    select: { messageId: true },
    distinct: ["messageId"],
  });
  await tx.chatRoomMention.updateMany({
    where,
    data: { status: "failed", error: params.error },
  });
  return mentions.map((mention) => mention.messageId);
}

export async function publishChatRoomMentionStatuses(
  messageIds: readonly string[],
): Promise<void> {
  const { publishChatRoomMessageRealtimeById } = await import(
    "@/helpers/chat-room-message-realtime"
  );
  await Promise.all(
    [...new Set(messageIds)].map((messageId) =>
      publishChatRoomMessageRealtimeById(messageId, "mention_status"),
    ),
  );
}
