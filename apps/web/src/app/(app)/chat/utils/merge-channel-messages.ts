import type { ChatRoomMessage } from "@/lib/clients/generated/core";

/**
 * Merge channel message pages by id. Incoming rows win (fresh reactions /
 * mention status). Result is sorted oldest → newest for reading order.
 */
export function mergeChannelMessages(
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

/**
 * Build the room transcript while a coworker stream overlay is active.
 * Overlay rows keep their array order (user then assistant) and are appended
 * after persisted history. Empty coworker shells never render.
 */
export function mergeMessagesWithStreamOverlay(
  persisted: readonly ChatRoomMessage[],
  streamOverlay: readonly ChatRoomMessage[],
): ChatRoomMessage[] {
  if (streamOverlay.length === 0) {
    return persisted.filter(hasVisibleMessageBody);
  }

  const overlayIds = new Set(streamOverlay.map((message) => message.id));
  const overlayUserContents = new Set(
    streamOverlay
      .filter(
        (message) =>
          message.sender.type === "user" && hasVisibleMessageBody(message),
      )
      .map((message) => message.content.trim()),
  );

  const history = persisted.filter((message) => {
    if (overlayIds.has(message.id)) {
      return false;
    }
    if (!hasVisibleMessageBody(message)) {
      return false;
    }
    // Core persists the user turn as soon as stream POST starts — drop that
    // duplicate while the stream: user bubble is already in the overlay.
    if (
      message.sender.type === "user" &&
      overlayUserContents.has(message.content.trim())
    ) {
      return false;
    }
    return true;
  });

  const visibleOverlay = streamOverlay.filter(hasVisibleMessageBody);
  return [...history, ...visibleOverlay];
}
