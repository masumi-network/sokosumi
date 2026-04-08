import type { UIMessage } from "ai";

/**
 * Loads persisted thread history as AI SDK `UIMessage[]` via the web BFF
 * (`GET {chatBffPath}?conversationId=…` → Core `GET /v1/chat`).
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
  const data = (await response.json()) as { messages?: unknown };
  if (!Array.isArray(data.messages)) {
    return null;
  }
  return data.messages as UIMessage[];
}
