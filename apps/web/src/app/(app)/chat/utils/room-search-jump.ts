import {
  CHAT_MESSAGE_LIST_ATTRIBUTE,
  CHAT_MESSAGE_LIST_ROOM,
  CHAT_MESSAGE_LIST_THREAD,
} from "@/app/chat/chat-message-list";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

export interface RoomSearchJumpDeps {
  holdOffBottom: () => void;
  releaseHoldOffBottom: () => void;
  /**
   * Land on the reply inside the open thread. False when the panel does not
   * hold it, which is the cue to load a window around it there.
   */
  highlightInThread: (messageId: string) => boolean;
  /** Settle after a thread window is merged, before the reply is landed on. */
  afterThreadRender: (messageId: string) => Promise<void>;
  /** The same wait for the transcript, used by the room branch. */
  afterRoomRender: (messageId: string) => Promise<void>;
  loadAroundInRoom: (aroundId: string) => Promise<boolean>;
  findLoadedParent: (parentMessageId: string) => ChatRoomMessage | undefined;
  loadParent: (parentMessageId: string) => Promise<ChatRoomMessage | null>;
  openThread: (parent: ChatRoomMessage) => Promise<boolean>;
  /**
   * Land on a message in the room transcript. False when the transcript has
   * not loaded it. The thread branch discards that answer, having no fallback
   * worth running; the room branch loads a window on it.
   */
  highlightInRoom: (messageId: string) => boolean;
  loadAroundInThread: (
    parentMessageId: string,
    aroundId: string,
  ) => Promise<boolean>;
}

/**
 * Wait up to three frames for a message to paint, or return the moment it has.
 *
 * Scoped to one list. Both lists render a thread's parent, so a document-wide
 * wait can be satisfied by the panel's copy and return before the transcript
 * has painted the row the caller is about to land on.
 */
export async function waitForSearchJumpPaint(
  messageId?: string,
  list: string = CHAT_MESSAGE_LIST_ROOM,
): Promise<void> {
  if (typeof requestAnimationFrame === "undefined") {
    return;
  }
  for (let frame = 0; frame < 3; frame += 1) {
    if (
      messageId &&
      typeof document !== "undefined" &&
      document.querySelector(
        `[${CHAT_MESSAGE_LIST_ATTRIBUTE}="${list}"] [data-message-id="${CSS.escape(messageId)}"]`,
      )
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

/** The thread panel's copy of that wait. */
export function waitForThreadJumpPaint(messageId?: string): Promise<void> {
  return waitForSearchJumpPaint(messageId, CHAT_MESSAGE_LIST_THREAD);
}

/**
 * The hold is kept on exactly the two paths where a window was loaded, one
 * in a thread and one in the room, so the view stays where the jump put it
 * rather than snapping back to the newest message. Whether the target was
 * reached does not come into it: the highlight is attempted and its answer is
 * not read, so a window that loads but never paints inside the paint wait
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
      await deps.afterThreadRender(hit.id);
      // True only when a window was loaded, which is the one case the view
      // has to stay held for.
      let windowLoaded = false;
      if (!deps.highlightInThread(hit.id)) {
        windowLoaded = await deps.loadAroundInThread(parent.id, hit.id);
        if (windowLoaded) {
          await deps.afterThreadRender(hit.id);
          deps.highlightInThread(hit.id);
        }
      }
      // The thread the reply lives in hangs off a message in the transcript,
      // and landing in the panel alone leaves that transcript wherever it
      // was, which is usually the newest message. So the room is put on the
      // parent as well, and marked there, and the reader can see what the
      // reply is a reply to.
      //
      // Last, after the reply has landed. `openThread` resolves on the state
      // that opens the panel rather than on the paint that renders it, and
      // opening the panel narrows the room column, so its rows re-wrap
      // taller. A transcript scrolled before that reflow drifts off centre by
      // the difference, and the growth it causes can re-pin the list to the
      // newest message once the hold is released.
      //
      // What holds it back is the wait on the reply above. That wait looks
      // for the reply at the top of each of its three frames, so it returns
      // as soon as the panel has it and spends the whole budget only when it
      // never arrives. The transcript is safe either way: a reply painted in
      // the panel is a panel that has laid out, and a panel that has laid out
      // has taken its width from the room column already. A budget spent in
      // full outlasts that reflow on its own.
      //
      // Landing last also keeps the two marks on screen together, however
      // long the reply's own window takes to load.
      //
      // Marked as well as scrolled. The two marks live in different lists, so
      // neither wipes the other, and the reply keeps the one that matters:
      // it is the message the reader was sent to.
      //
      // A parent further back than the loaded page is left alone. Loading a
      // window around it swaps the timeline and marks it historical, which
      // stops every later realtime message from merging, and that is too much
      // to pay to move a transcript the thread panel is covering.
      deps.highlightInRoom(parent.id);
      if (!windowLoaded) {
        deps.releaseHoldOffBottom();
      }
      return;
    }

    if (deps.highlightInRoom(hit.id)) {
      deps.releaseHoldOffBottom();
      return;
    }
    const loaded = await deps.loadAroundInRoom(hit.id);
    if (!loaded) {
      deps.releaseHoldOffBottom();
      return;
    }
    await deps.afterRoomRender(hit.id);
    deps.highlightInRoom(hit.id);
  } catch (error) {
    deps.releaseHoldOffBottom();
    throw error;
  }
}
