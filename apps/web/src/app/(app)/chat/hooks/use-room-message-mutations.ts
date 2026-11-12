"use client";

import type { ChatRoomMessage } from "@sokosumi/core-client";
import { CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import {
  type Dispatch,
  type SetStateAction,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  deleteRoomMessageAction,
  editRoomMessageAction,
  pinRoomMessageAction,
  removeRoomMessageUnfurlAction,
  unpinRoomMessageAction,
} from "@/app/chat/actions";
import { isRoomComposerContentOverLimit } from "@/app/chat/components/room-helpers";
import { applyReplySoftDeleteToParentIfUnchanged } from "@/app/chat/utils/parent-thread-preview";

interface RoomMessageMutationsOptions {
  /** Read at call time: the open Room is resolved after this hook runs. */
  getSelectedRoomId: () => string | undefined;
  isStillSelectedRoom: (roomId: string) => boolean;
  mergeUpdatedMessage: (updatedMessage: ChatRoomMessage) => void;
  messagesState: readonly ChatRoomMessage[];
  setMessagesState: (update: SetStateAction<ChatRoomMessage[]>) => void;
  threadParentMessage: ChatRoomMessage | null;
  setThreadParentMessage: Dispatch<SetStateAction<ChatRoomMessage | null>>;
}

/** Pin, edit, link-preview removal and delete for the messages of one Room. */
export function useRoomMessageMutations({
  getSelectedRoomId,
  isStillSelectedRoom,
  mergeUpdatedMessage,
  messagesState,
  setMessagesState,
  threadParentMessage,
  setThreadParentMessage,
}: RoomMessageMutationsOptions) {
  const t = useTranslations("App.Channels");
  const [pinnedListGeneration, setPinnedListGeneration] = useState(0);
  // inThread: the open thread also shows its parent message, so only the
  // surface that started the edit mounts the editor. Two editors steal focus
  // from each other and the blurred one cancels the edit.
  const [editSession, setEditSession] = useState<{
    messageId: string;
    draft: string;
    inThread: boolean;
  } | null>(null);
  const [isSavingEdit, startSavingEditTransition] = useTransition();
  const [_isDeleting, startDeleteTransition] = useTransition();
  const [pinWrites] = useState(
    () =>
      new Map<
        string,
        { pinned: boolean; echoed: boolean; done: Promise<boolean> }
      >(),
  );
  // Rows that show a change Core has not answered yet. The row reads as
  // saving until the answer comes, success or failure.
  const [savingMessageIds, setSavingMessageIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  function setMessageSaving(messageId: string, saving: boolean) {
    setSavingMessageIds((current) => {
      if (current.has(messageId) === saving) return current;
      const next = new Set(current);
      if (saving) next.add(messageId);
      else next.delete(messageId);
      return next;
    });
  }

  function setRowPinned(messageId: string, pinned: boolean) {
    // Unloaded rows arrive with Core's pinnedAt. The local time stands in
    // until the next read; only pinned-or-not is shown.
    setMessagesState((current) =>
      current.map((message) =>
        message.id === messageId && (message.pinnedAt != null) !== pinned
          ? { ...message, pinnedAt: pinned ? new Date() : null }
          : message,
      ),
    );
  }

  function applyPinnedMutation(messageId: string, pinned: boolean) {
    const openWrite = pinWrites.get(messageId);
    if (openWrite?.pinned === pinned) {
      openWrite.echoed = true;
    }
    setRowPinned(messageId, pinned);
    setPinnedListGeneration((generation) => generation + 1);
  }

  /**
   * The row shows the new state at once. The pinned list reads Core, so it
   * loads again only after Core has the write. A refused write puts the row
   * back, unless a realtime event with the same state came in the meantime:
   * then Core has the write and only the answer was lost. One write per
   * message: a second request for the same state shares the open write, one
   * for the other state is dropped.
   */
  function writePinned(
    roomId: string,
    messageId: string,
    pinned: boolean,
  ): Promise<boolean> {
    const openWrite = pinWrites.get(messageId);
    if (openWrite) {
      return openWrite.pinned === pinned
        ? openWrite.done
        : Promise.resolve(false);
    }
    const write = { pinned, echoed: false, done: Promise.resolve(false) };
    pinWrites.set(messageId, write);
    setRowPinned(messageId, pinned);
    setMessageSaving(messageId, true);
    write.done = (
      pinned
        ? pinRoomMessageAction(roomId, messageId)
        : unpinRoomMessageAction(roomId, messageId)
    )
      .catch(() => null)
      .then((result) => {
        pinWrites.delete(messageId);
        setMessageSaving(messageId, false);
        if (!result?.ok) {
          const restoredPinned = write.echoed ? pinned : !pinned;
          setRowPinned(messageId, restoredPinned);
          toast.error(
            result?.error.message ??
              t(
                pinned
                  ? "PinnedMessages.pinError"
                  : "PinnedMessages.unpinError",
              ),
            // Says how the row stands now, so the jump back is explained.
            {
              description: t(
                restoredPinned
                  ? "PinnedMessages.statePinned"
                  : "PinnedMessages.stateUnpinned",
              ),
            },
          );
          return false;
        }
        // A read that began before the write, or a late event from an
        // earlier write, can have put the old state back.
        setRowPinned(messageId, pinned);
        setPinnedListGeneration((generation) => generation + 1);
        return true;
      });
    return write.done;
  }

  async function handlePinMessage(message: ChatRoomMessage) {
    const roomId = getSelectedRoomId();
    if (!roomId) {
      return;
    }
    await writePinned(roomId, message.id, message.pinnedAt == null);
  }

  function handleUnpinFromPanel(roomId: string, messageId: string) {
    return writePinned(roomId, messageId, false);
  }

  function handleStartEdit(message: ChatRoomMessage, inThread: boolean) {
    setEditSession({ messageId: message.id, draft: message.content, inThread });
  }

  function handleCancelEdit() {
    if (isSavingEdit) return;
    setEditSession(null);
  }

  function handleEditDraftChange(draft: string) {
    setEditSession((current) => (current ? { ...current, draft } : current));
  }

  function handleSaveEdit(contentOverride?: string) {
    const roomId = getSelectedRoomId();
    if (!roomId || !editSession || isSavingEdit) return;
    const { messageId, draft } = editSession;
    // Prefer live editor text (Enter can fire before React flushes onChange).
    const raw = contentOverride ?? draft;
    const content = raw.trim();
    if (!content) return;
    if (isRoomComposerContentOverLimit(content)) {
      toast.error(
        t("composerTooLong", {
          count: content.length,
          max: CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
        }),
      );
      return;
    }

    // Keep controlled draft in sync with what we submit so a failed save still
    // shows the text the user actually confirmed (not a stale parent draft).
    if (contentOverride !== undefined && contentOverride !== draft) {
      setEditSession((current) =>
        current?.messageId === messageId
          ? { ...current, draft: contentOverride }
          : current,
      );
    }

    startSavingEditTransition(async () => {
      const result = await editRoomMessageAction(roomId, messageId, content);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      mergeUpdatedMessage(result.value);
      setEditSession((current) =>
        current?.messageId === messageId ? null : current,
      );
    });
  }

  function handleRemoveUnfurl(message: ChatRoomMessage, url: string) {
    const roomId = getSelectedRoomId();
    if (!roomId) {
      return;
    }
    void (async () => {
      const result = await removeRoomMessageUnfurlAction(
        roomId,
        message.id,
        url,
      );
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      mergeUpdatedMessage(result.value);
    })();
  }

  function handleDeleteMessage(message: ChatRoomMessage) {
    const roomId = getSelectedRoomId();
    if (!roomId) return;
    // Snapshot parent count before the request so a racing Ably parent
    // update (server re-publish after reply soft-delete) is not double-applied.
    const parentMessageId = message.parentMessageId;
    const wasLiveReply = parentMessageId != null && message.deletedAt == null;
    const parentCountBefore = wasLiveReply
      ? threadParentMessage?.id === parentMessageId
        ? threadParentMessage.threadReplyCount
        : (messagesState.find((row) => row.id === parentMessageId)
            ?.threadReplyCount ?? null)
      : null;

    startDeleteTransition(async () => {
      const result = await deleteRoomMessageAction(roomId, message.id);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      mergeUpdatedMessage(result.value);

      if (
        wasLiveReply &&
        parentMessageId != null &&
        parentCountBefore != null &&
        result.value.deletedAt != null
      ) {
        const applyParent = (row: ChatRoomMessage) =>
          applyReplySoftDeleteToParentIfUnchanged(
            row,
            parentMessageId,
            parentCountBefore,
          );
        setMessagesState((current) => current.map(applyParent));
        setThreadParentMessage((current) =>
          current ? applyParent(current) : null,
        );
      }
    });
  }

  return {
    pinnedListGeneration,
    setPinnedListGeneration,
    editSession,
    setEditSession,
    isSavingEdit,
    savingMessageIds,
    applyPinnedMutation,
    handlePinMessage,
    handleUnpinFromPanel,
    handleStartEdit,
    handleCancelEdit,
    handleEditDraftChange,
    handleSaveEdit,
    handleRemoveUnfurl,
    handleDeleteMessage,
  };
}
