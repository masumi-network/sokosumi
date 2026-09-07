import type { ChatRoomMessage } from "@/lib/clients/generated/core";

export interface RoomSearchJumpDeps {
  holdOffBottom: () => void;
  releaseHoldOffBottom: () => void;
  highlight: (messageId: string) => boolean;
  afterRender: (messageId: string) => Promise<void>;
  loadAroundInRoom: (aroundId: string) => Promise<boolean>;
  findLoadedParent: (parentMessageId: string) => ChatRoomMessage | undefined;
  loadParent: (parentMessageId: string) => Promise<ChatRoomMessage | null>;
  openThread: (parent: ChatRoomMessage) => Promise<boolean>;
  loadAroundInThread: (
    parentMessageId: string,
    aroundId: string,
  ) => Promise<boolean>;
}

export async function waitForSearchJumpPaint(
  messageId?: string,
): Promise<void> {
  if (typeof requestAnimationFrame === "undefined") {
    return;
  }
  for (let frame = 0; frame < 3; frame += 1) {
    if (
      messageId &&
      typeof document !== "undefined" &&
      document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    ) {
      return;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  }
}

/**
 * The hold is kept on every path that arrives somewhere, so the view stays
 * where the jump put it. It is dropped on every path that arrives nowhere,
 * because a room holding off the bottom for a jump that never happened stops
 * following new messages and cannot be re-armed by scrolling.
 */
export async function performRoomSearchJump(
  hit: ChatRoomMessage,
  deps: RoomSearchJumpDeps,
): Promise<void> {
  deps.holdOffBottom();
  if (hit.parentMessageId) {
    const parent =
      deps.findLoadedParent(hit.parentMessageId) ??
      (await deps.loadParent(hit.parentMessageId));
    if (!parent) {
      // Nothing was opened, so nothing wants the view held. A room left
      // holding off the bottom stops following new messages, and the reader
      // cannot re-arm it by scrolling.
      deps.releaseHoldOffBottom();
      return;
    }
    await deps.openThread(parent);
    await deps.afterRender(hit.id);
    if (deps.highlight(hit.id)) {
      deps.releaseHoldOffBottom();
      return;
    }
    const loaded = await deps.loadAroundInThread(parent.id, hit.id);
    if (!loaded) {
      deps.releaseHoldOffBottom();
      return;
    }
    await deps.afterRender(hit.id);
    deps.highlight(hit.id);
    return;
  }

  if (deps.highlight(hit.id)) {
    deps.releaseHoldOffBottom();
    return;
  }
  const loaded = await deps.loadAroundInRoom(hit.id);
  if (!loaded) {
    deps.releaseHoldOffBottom();
    return;
  }
  await deps.afterRender(hit.id);
  deps.highlight(hit.id);
}
