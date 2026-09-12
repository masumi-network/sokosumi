"use client";

import { type RefObject, useRef } from "react";
import { toast } from "sonner";

import {
  getRoomThreadAction,
  listRoomMessagesAction,
  listThreadMessagesAction,
} from "@/app/chat/actions";
import {
  createRoomJumpState,
  startRoomJump,
} from "@/app/chat/utils/room-jump-hold";
import { highlightThreadMessage } from "@/app/chat/utils/room-message-highlight";
import { performRoomMessageJump } from "@/app/chat/utils/room-message-jump";
import {
  performRoomSearchJump,
  waitForSearchJumpPaint,
  waitForThreadJumpPaint,
} from "@/app/chat/utils/room-search-jump";
import {
  ROOM_HISTORY_WINDOW_LIMIT,
  type RoomTranscriptPage,
} from "@/app/chat/utils/room-transcript-ranges";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

interface RoomMessageJumpsParams {
  roomId: string | null;
  topLevelRoomMessages: ChatRoomMessage[];
  threadParentMessage: ChatRoomMessage | null;
  isStillSelectedRoom: (roomId: string) => boolean;
  /**
   * Land on a message in the room transcript and mark it. False when the
   * transcript has not loaded it, which is the cue to load a window on it.
   */
  landOnRoomMessage: (messageId: string) => boolean;
  suppressStickToBottom: () => void;
  releaseStickToBottomSuppress: () => void;
  setSearchHoldOffBottom: (hold: boolean) => void;
  /**
   * Merge a window loaded around a jump target into the transcript as its
   * own loaded range. The head stays on screen and the room stays live; a
   * gap row marks whatever sits between the window and the rest.
   */
  mergeRoomJumpWindow: (page: RoomTranscriptPage) => void;
  historicalThreadRef: RefObject<boolean>;
  setThreadMessages: (messages: ChatRoomMessage[]) => void;
  setThreadOlderNextCursor: (cursor: string | null) => void;
  handleOpenThreadFromMessage: (parent: ChatRoomMessage) => Promise<boolean>;
}

export function useRoomMessageJumps({
  roomId,
  topLevelRoomMessages,
  threadParentMessage,
  isStillSelectedRoom,
  landOnRoomMessage,
  suppressStickToBottom,
  releaseStickToBottomSuppress,
  setSearchHoldOffBottom,
  mergeRoomJumpWindow,
  historicalThreadRef,
  setThreadMessages,
  setThreadOlderNextCursor,
  handleOpenThreadFromMessage,
}: RoomMessageJumpsParams) {
  const jumpStateRef = useRef(createRoomJumpState());

  function invalidateJump() {
    jumpStateRef.current.generation += 1;
  }

  /**
   * Load a window around one top-level message and merge it as a range.
   * Shared by every room-level jump, so a search hit, a pinned message, and a
   * notification all leave the transcript in the same shape.
   */
  async function loadRoomWindow(
    roomId: string,
    aroundId: string,
    isNewestJump: () => boolean,
  ): Promise<boolean> {
    const result = await listRoomMessagesAction(roomId, {
      around: aroundId,
      limit: ROOM_HISTORY_WINDOW_LIMIT,
    });
    if (!isStillSelectedRoom(roomId) || !isNewestJump()) {
      return false;
    }
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    mergeRoomJumpWindow(result.value);
    return true;
  }

  async function handleSearchJump(
    hit: ChatRoomMessage,
    options?: {
      /**
       * Say nothing when the reply's thread is no longer there. Wanted on the
       * notification path, where the reader already has the room the
       * notification opened and a missing thread is a settled answer rather
       * than a fault. The search panel wants the opposite: it closes on the
       * click, so silence would leave that click looking ignored.
       */
      quietWhenThreadIsGone?: boolean;
    },
  ) {
    if (!roomId) {
      return;
    }
    const { isNewestJump, holdOffBottom, releaseHoldOffBottom } = startRoomJump(
      jumpStateRef.current,
      {
        isStillSelectedRoom: () => isStillSelectedRoom(roomId),
        hold: () => {
          suppressStickToBottom();
          setSearchHoldOffBottom(true);
        },
        release: () => {
          releaseStickToBottomSuppress();
          setSearchHoldOffBottom(false);
        },
      },
    );
    await performRoomSearchJump(hit, {
      holdOffBottom,
      releaseHoldOffBottom,
      // Guarded because a superseded jump reaching this would scroll the
      // reader off the message a later click has already put them on.
      //
      // Scoped to the thread, which is the list this hit lives in: the jump
      // reaches here only for a reply, and a reply is never on the room
      // timeline.
      highlightInThread: (id) => isNewestJump() && highlightThreadMessage(id),
      afterThreadRender: waitForThreadJumpPaint,
      afterRoomRender: waitForSearchJumpPaint,
      loadAroundInRoom: (aroundId) =>
        loadRoomWindow(roomId, aroundId, isNewestJump),
      findLoadedParent: (parentId) =>
        topLevelRoomMessages.find((message) => message.id === parentId) ??
        (threadParentMessage?.id === parentId
          ? threadParentMessage
          : undefined),
      loadParent: async (parentId) => {
        const result = await getRoomThreadAction(roomId, parentId);
        // Checked before the error is shown, as in the other loads a jump
        // makes: once the reader has moved on, neither the result nor a
        // complaint about it belongs on the room they moved to. This one also
        // guards state, because `loadThreadMessages` opens the panel before
        // its first await, too early to check for itself. A superseded jump
        // stops here for the same reason: opening its thread would put the
        // wrong parent over the one a later click is opening.
        if (!isStillSelectedRoom(roomId) || !isNewestJump()) {
          return null;
        }
        if (!result.ok) {
          // A thread that is simply not there is the answer, not a fault, and
          // on the notification path saying so is the loud second failure
          // this jump exists to avoid: the reader is left in the room the
          // notification already opened.
          //
          // It happens whenever the thread Core would return is gone. The
          // parent may be deleted, or the reply itself may be deleted with no
          // live reply left to keep the thread addressable: the aggregate
          // requires both `parent."deletedAt" IS NULL` and one surviving
          // reply. Either way the parent was neither in the loaded timeline
          // nor the open thread's, or `findLoadedParent` above would have
          // short-circuited this.
          const quiet =
            options?.quietWhenThreadIsGone === true &&
            result.error.code === CommonErrorCode.NOT_FOUND;
          if (!quiet) {
            toast.error(result.error.message);
          }
          return null;
        }
        return result.value.parentMessage;
      },
      // Opened even when the panel already shows this thread, which costs a
      // blank list and a refetch. Skipping it would also skip the load
      // generation it bumps, and a reply list still in flight from the first
      // click would then land on top of the window this jump loads and leave
      // the thread flagged historical.
      openThread: handleOpenThreadFromMessage,
      // Guarded like the highlight above it: a superseded jump moving the
      // transcript would drag the reader off what a later click put them on.
      //
      // Answers for the transcript alone. An open thread renders its parent
      // too, and taking that copy for a landing would end a jump with the
      // transcript never moved.
      highlightInRoom: (id) => isNewestJump() && landOnRoomMessage(id),
      loadAroundInThread: async (parentId, aroundId) => {
        const result = await listThreadMessagesAction(roomId, parentId, {
          around: aroundId,
        });
        if (!isStillSelectedRoom(roomId) || !isNewestJump()) {
          return false;
        }
        if (!result.ok) {
          toast.error(result.error.message);
          return false;
        }
        historicalThreadRef.current = true;
        setThreadMessages(result.value.messages);
        setThreadOlderNextCursor(result.value.nextCursor);
        return true;
      },
    });
  }

  /**
   * Put a message on screen and highlight it, loading the window around it
   * when it is not already there. Reached from the pinned list and from a
   * notification that named the message on the room's URL. True once the
   * message is on screen.
   */
  async function handleJumpToMessage(messageId: string): Promise<boolean> {
    if (!roomId) {
      return false;
    }
    // Held through the scroller's refs alone. The state flag exists for the
    // thread panel, which a room jump never touches, and toggling it
    // re-renders every row in the transcript twice, once on hold and once on
    // release, which with a couple of hundred rows on screen was most of the
    // wait after the window had already loaded.
    const { isNewestJump, holdOffBottom, releaseHoldOffBottom } = startRoomJump(
      jumpStateRef.current,
      {
        isStillSelectedRoom: () => isStillSelectedRoom(roomId),
        hold: suppressStickToBottom,
        release: releaseStickToBottomSuppress,
      },
    );
    return performRoomMessageJump(messageId, {
      // Guarded because this runs twice: once on entry, where this jump is
      // always the newest, and once after the window loads, where it may not
      // be. Scrolling then would drag the reader off the message a later
      // click has already put them on.
      //
      // Scoped to the transcript, which is the list this jump moves. An open
      // thread renders its parent as well, so a document-wide lookup would
      // answer from the panel for a message the transcript has not loaded and
      // end the jump with the transcript untouched.
      highlight: (id) => isNewestJump() && landOnRoomMessage(id),
      holdOffBottom,
      releaseHoldOffBottom,
      loadAround: (aroundId) => loadRoomWindow(roomId, aroundId, isNewestJump),
      // `RoomMessageJumpDeps.afterRender` takes no message id, so this waits
      // a fixed few frames for the merged window to settle rather than
      // returning the moment the target exists. The stick-to-bottom observer
      // has to see the growth while the hold is still on, or it re-pins the
      // view to the newest message and undoes the jump.
      afterRender: waitForSearchJumpPaint,
    });
  }

  return { handleSearchJump, handleJumpToMessage, invalidateJump };
}
