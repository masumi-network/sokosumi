import type { UIMessage } from "ai";

import { convertItemsToMessages } from "@/app/chat/utils/message-utils";
import { getConversationMessages } from "@/lib/actions/conversation/core-api-actions";
import type { ConversationMessage } from "@/lib/clients/generated/core/types.gen";

type SerializedConversationMessagesResult =
  | {
      ok: true;
      data: { messages: ConversationMessage[] };
    }
  | { ok: false; error: unknown }
  | { isOk: () => boolean; value?: unknown };

function readMessagesFromResult(
  rawItemsResult: unknown,
): ConversationMessage[] | null {
  const resultAny = rawItemsResult as SerializedConversationMessagesResult;

  if (
    resultAny &&
    "ok" in resultAny &&
    resultAny.ok === true &&
    "data" in resultAny &&
    resultAny.data &&
    typeof resultAny.data === "object" &&
    "messages" in resultAny.data
  ) {
    return resultAny.data.messages;
  }

  if (
    resultAny &&
    "isOk" in resultAny &&
    typeof resultAny.isOk === "function" &&
    resultAny.isOk() &&
    "value" in resultAny
  ) {
    const value = resultAny.value as { messages: ConversationMessage[] };
    return value.messages;
  }

  return null;
}

export async function fetchConversationUiMessages(
  conversationId: string,
): Promise<UIMessage[] | null> {
  const raw = await getConversationMessages({
    conversationId,
    limit: 100,
  });
  const items = readMessagesFromResult(raw);
  if (!items || items.length === 0) {
    return null;
  }
  return convertItemsToMessages(items);
}
