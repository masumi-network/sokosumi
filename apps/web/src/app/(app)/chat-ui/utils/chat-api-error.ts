import type { UIMessage } from "ai";

interface ParsedChatApiErrorBody {
  error?: string;
  message?: string;
}

export function parseChatApiErrorBody(
  error: unknown,
): ParsedChatApiErrorBody | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const raw = error.message.trim();
  if (!raw.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ParsedChatApiErrorBody;
    if (typeof parsed.error !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isCoworkerChatConflictError(error: unknown): boolean {
  return parseChatApiErrorBody(error)?.error === "Conflict";
}

export function removeTrailingUserUiMessage(
  messages: UIMessage[],
): UIMessage[] {
  const last = messages[messages.length - 1];
  if ((last?.role as string) === "user") {
    return messages.slice(0, -1);
  }
  return messages;
}
