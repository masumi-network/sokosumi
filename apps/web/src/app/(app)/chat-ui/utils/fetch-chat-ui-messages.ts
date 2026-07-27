import type { UIMessage } from "ai";

/**
 * Loads persisted thread history as AI SDK `UIMessage[]` via the web BFF
 * (`GET {chatBffPath}?conversationId=…` → Core `GET /v1/chats/stream`).
 */
export async function fetchChatUiMessages(
  conversationId: string,
  chatBffPath: string,
): Promise<UIMessage[] | null> {
  const response = await fetch(
    `${chatBffPath}?${new URLSearchParams({ conversationId })}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as {
    data?: { messages?: unknown };
    messages?: unknown;
  };
  const messages = payload.data?.messages ?? payload.messages;
  if (!Array.isArray(messages)) {
    return null;
  }
  return messages as UIMessage[];
}
