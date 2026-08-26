import type { ChatRoomMessage } from "@/lib/clients/generated/core";

export interface RoomSearchJumpDeps {
  highlight: (messageId: string) => boolean;
  afterRender: () => Promise<void>;
  loadAroundInRoom: (aroundId: string) => Promise<boolean>;
  findLoadedParent: (parentMessageId: string) => ChatRoomMessage | undefined;
  loadParent: (parentMessageId: string) => Promise<ChatRoomMessage | null>;
  openThread: (parent: ChatRoomMessage) => Promise<boolean>;
  loadAroundInThread: (
    parentMessageId: string,
    aroundId: string,
  ) => Promise<boolean>;
}

export async function waitForSearchJumpPaint(): Promise<void> {
  if (typeof requestAnimationFrame === "undefined") {
    return;
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

export async function performRoomSearchJump(
  hit: ChatRoomMessage,
  deps: RoomSearchJumpDeps,
): Promise<void> {
  if (hit.parentMessageId) {
    const parent =
      deps.findLoadedParent(hit.parentMessageId) ??
      (await deps.loadParent(hit.parentMessageId));
    if (!parent) {
      return;
    }
    await deps.openThread(parent);
    await deps.afterRender();
    if (deps.highlight(hit.id)) {
      return;
    }
    const loaded = await deps.loadAroundInThread(parent.id, hit.id);
    if (!loaded) {
      return;
    }
    await deps.afterRender();
    deps.highlight(hit.id);
    return;
  }

  if (deps.highlight(hit.id)) {
    return;
  }
  const loaded = await deps.loadAroundInRoom(hit.id);
  if (!loaded) {
    return;
  }
  await deps.afterRender();
  deps.highlight(hit.id);
}
