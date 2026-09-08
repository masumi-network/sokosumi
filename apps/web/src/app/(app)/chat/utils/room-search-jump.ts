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
 * The hold is kept exactly where a window was loaded, which is two of the
 * eight ways out, so the view stays where the jump put it rather than snapping
 * back to the newest message. On both of those the highlight is attempted and
 * its answer is not read, so a window that loads but never paints inside
 * `afterRender` keeps the hold as well.
 *
 * It is dropped on the other six, none of which loaded a window: a target the
 * jump could reach without one, whether it was on screen from the start or
 * became visible when the thread opened; every path that gives up first; and a
 * dependency that rejects. A room holding off the bottom for a jump that never
 * happened stops following new messages and cannot be re-armed by scrolling.
 *
 * The rejection case is a transport failure rather than a refusal: these
 * actions report a server-side error by returning one. It matters because a
 * notification for a thread reply routes through here and does not surface
 * what it catches, so a dropped connection would otherwise leave the reader
 * with a room stuck off the bottom and no message and no word of why.
 */
export async function performRoomSearchJump(
  hit: ChatRoomMessage,
  deps: RoomSearchJumpDeps,
): Promise<void> {
  deps.holdOffBottom();
  try {
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
  } catch (error) {
    deps.releaseHoldOffBottom();
    throw error;
  }
}
