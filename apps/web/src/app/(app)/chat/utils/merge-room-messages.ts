import type { ChatRoomMessage } from "@/lib/clients/generated/core";

/**
 * Merge room message pages by id. Incoming rows win (fresh reactions /
 * mention status). Result is sorted oldest → newest for reading order.
 */
export function mergeRoomMessages(
  existing: readonly ChatRoomMessage[],
  incoming: readonly ChatRoomMessage[],
): ChatRoomMessage[] {
  const byId = new Map<string, ChatRoomMessage>();
  for (const message of existing) {
    byId.set(message.id, message);
  }
  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return Array.from(byId.values()).toSorted((left, right) => {
    const timeDelta =
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (timeDelta !== 0) {
      return timeDelta;
    }

    // Stream overlays often share a millisecond; never let id lexicographic
    // order put an empty/assistant bubble above the user turn that triggered it.
    const leftStream = left.id.startsWith("stream:");
    const rightStream = right.id.startsWith("stream:");
    if (leftStream && rightStream) {
      const leftRank = streamSenderSortRank(left);
      const rightRank = streamSenderSortRank(right);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
    }

    return left.id.localeCompare(right.id);
  });
}

function streamSenderSortRank(message: ChatRoomMessage): number {
  if (message.sender.type === "user") {
    return 0;
  }
  if (message.sender.type === "coworker") {
    return 1;
  }
  return 2;
}

function hasVisibleMessageBody(message: ChatRoomMessage): boolean {
  return message.content.trim().length > 0;
}

/** Empty stream coworker shells stay visible (avatar/name + waiting state). */
function shouldRenderInTranscript(message: ChatRoomMessage): boolean {
  if (hasVisibleMessageBody(message)) {
    return true;
  }
  return message.id.startsWith("stream:") && message.sender.type === "coworker";
}

/**
 * Build the room transcript while a coworker stream overlay is active.
 * Overlay rows keep their array order (user then assistant) and are appended
 * after persisted history. Empty coworker stream shells stay for waiting UX.
 */
export function mergeMessagesWithStreamOverlay(
  persisted: readonly ChatRoomMessage[],
  streamOverlay: readonly ChatRoomMessage[],
): ChatRoomMessage[] {
  if (streamOverlay.length === 0) {
    return persisted.filter(hasVisibleMessageBody);
  }

  const overlayIds = new Set(streamOverlay.map((message) => message.id));
  // One hide per overlay user occurrence (prefer latest persisted match).
  // Same text sent twice must not wipe both history rows for one overlay.
  const overlayUserContentRemaining = new Map<string, number>();
  for (const message of streamOverlay) {
    if (message.sender.type !== "user" || !hasVisibleMessageBody(message)) {
      continue;
    }
    const content = message.content.trim();
    overlayUserContentRemaining.set(
      content,
      (overlayUserContentRemaining.get(content) ?? 0) + 1,
    );
  }

  const hidePersistedUserIds = new Set<string>();
  for (let index = persisted.length - 1; index >= 0; index -= 1) {
    const message = persisted[index];
    if (!message) {
      continue;
    }
    if (overlayIds.has(message.id)) {
      continue;
    }
    if (message.sender.type !== "user" || !hasVisibleMessageBody(message)) {
      continue;
    }
    const content = message.content.trim();
    const remaining = overlayUserContentRemaining.get(content) ?? 0;
    if (remaining <= 0) {
      continue;
    }
    hidePersistedUserIds.add(message.id);
    overlayUserContentRemaining.set(content, remaining - 1);
  }

  const history = persisted.filter((message) => {
    if (overlayIds.has(message.id)) {
      return false;
    }
    if (!hasVisibleMessageBody(message)) {
      return false;
    }
    // Core persists the user turn as soon as stream POST starts — drop that
    // duplicate while the stream: user bubble is already in the overlay.
    if (hidePersistedUserIds.has(message.id)) {
      return false;
    }
    return true;
  });

  const orderedOverlay = streamOverlay.filter(shouldRenderInTranscript);
  return [...history, ...orderedOverlay];
}
