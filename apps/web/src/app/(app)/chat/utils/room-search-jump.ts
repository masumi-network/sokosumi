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
    return;
  }
  await deps.afterRender(hit.id);
  deps.highlight(hit.id);
}
