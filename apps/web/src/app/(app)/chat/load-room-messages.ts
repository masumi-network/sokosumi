import { CoreApiRequestError } from "@/lib/clients/core.client";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";
import { chatRoomService } from "@/lib/services";

export async function loadRoomMessages(roomId: string | null): Promise<{
  messages: ChatRoomMessage[];
  nextCursor: string | null;
  failed: boolean;
}> {
  if (!roomId) {
    return { messages: [], nextCursor: null, failed: false };
  }

  try {
    const page = await chatRoomService.listMessages(roomId);
    return {
      messages: page.messages,
      nextCursor: page.nextCursor,
      failed: false,
    };
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      console.error("Failed to load room messages", {
        roomId,
        status: error.status,
        kind: error.kind,
      });
      return { messages: [], nextCursor: null, failed: true };
    }

    throw error;
  }
}

export function firstSearchValue(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}
