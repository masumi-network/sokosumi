import type { UIMessage } from "ai";

/**
 * Loads persisted thread history as AI SDK `UIMessage[]` via the experimental
 * BFF (`GET /api/new-chat` → Core `GET /v1/chat`).
 */
export async function fetchNewChatUiMessages(
  conversationId: string,
): Promise<UIMessage[] | null> {
  const response = await fetch(
    `/api/new-chat?${new URLSearchParams({ conversationId })}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as { messages?: unknown };
  if (!Array.isArray(data.messages)) {
    return null;
  }
  return data.messages as UIMessage[];
}
