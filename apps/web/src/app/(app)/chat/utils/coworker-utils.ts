export type CoworkerCapability = "chat" | "tasks";

interface CoworkerAvailability {
  capabilities?: readonly CoworkerCapability[];
  archivedAt?: Date | string | null;
  isWhitelisted?: boolean;
  canChat?: boolean;
  baseURL?: string | null;
}

export function coworkerHasCapability(
  coworker: CoworkerAvailability,
  capability: CoworkerCapability,
): boolean {
  return coworker.capabilities?.includes(capability) ?? false;
}

function hasRunnableChatEndpoint(coworker: CoworkerAvailability): boolean {
  return typeof coworker.baseURL === "string" && coworker.baseURL.trim() !== "";
}

/**
 * Active (not archived) only. Workspace usability (global whitelist ∪
 * GRANTED early access) is owned by Core `scope=available` /
 * `validateChatCoworkerIds` — do not re-gate on isWhitelisted here or
 * pilot coworkers vanish from channel/task pickers.
 */
function isActiveCoworker(coworker: CoworkerAvailability): boolean {
  return coworker.archivedAt == null;
}

export function coworkerCanChat(coworker: CoworkerAvailability): boolean {
  if (typeof coworker.canChat === "boolean") {
    return coworker.canChat;
  }

  return (
    isActiveCoworker(coworker) &&
    coworkerHasCapability(coworker, "chat") &&
    hasRunnableChatEndpoint(coworker)
  );
}
