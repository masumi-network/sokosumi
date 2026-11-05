import { z } from "@hono/zod-openapi";
import { mapChatRoomMessage } from "@/routes/v1/chats/rooms/helpers";
import { chatSignalListItemSchema } from "@/schemas/chat-signal.schema";
import type { ChatSignalListItem } from "@/services/chat-signal-views.service";

export function mapChatSignalListItems(
  items: readonly ChatSignalListItem[],
  userId: string,
) {
  return z.array(chatSignalListItemSchema).parse(
    items.map((item) => ({
      kind: item.kind,
      room: item.room,
      message: mapChatRoomMessage(item.message, userId),
      dueAt: item.dueAt,
    })),
  );
}
