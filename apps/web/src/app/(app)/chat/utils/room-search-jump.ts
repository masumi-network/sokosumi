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
  /**
   * Scroll the room transcript to a message, without marking it. Does nothing
   * when the message is not in the loaded page, and says so to nobody: there
   * is no fallback worth running, so an answer here would only be discarded.
   */
  scrollInRoom: (messageId: string) => void;
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
 * The hold is kept on exactly the two paths where a window was loaded, one
 * in a thread and one in the room, so the view stays where the jump put it
 * rather than snapping back to the newest message. Whether the target was
 * reached does not come into it: the highlight is attempted and its answer is
 * not read, so a window that loads but never paints inside `afterRender`
 * keeps the hold as well.
 *
 * Every other way out of the try releases it: a target the jump reached
 * without a window, whether it was on screen from the start or became visible
 * when the thread opened; a path that gives up first; and the `catch`. The
 * `catch` is the one that is not about whether a window loaded. Two of the
 * pairs it covers, the highlight and the paint wait that follow
 * `loadAroundInThread` and `loadAroundInRoom`, run after one has been, so a
 * rejection from those releases a hold the successful path would have kept.
 * A room holding off the bottom for a jump that never finished stops
 * following new messages until the flag is cleared, which a room switch
 * does.
 *
 * A rejection from one of the loads is a transport failure rather than a
 * refusal: those actions report a server-side error by returning one. The
 * highlight and the paint wait can throw as well, and land in the same
 * place. It matters because a
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
      // The thread the reply lives in hangs off a message in the transcript,
      // and landing in the panel alone leaves that transcript wherever it
      // was, which is usually the newest message. So the room is put on the
      // parent too, and the reader can see what the reply is a reply to.
      //
      // After the panel opens, or the layout shift that opening it causes
      // would move the transcript out from under a scroll that had landed.
      //
      // Scrolled and not marked: `highlightRoomMessageElement` keeps one mark
      // at a time, so a mark here would be wiped by the reply's own a moment
      // later. The mark belongs to the reply in any case, which is the
      // message the reader was sent to.
      //
      // A parent further back than the loaded page is left alone. Loading a
      // window around it swaps the timeline and marks it historical, which
      // stops every later realtime message from merging, and that is too much
      // to pay to move a transcript the thread panel is covering.
      deps.scrollInRoom(parent.id);
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
