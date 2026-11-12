"use client";

import type { ChatRoomMessage } from "@sokosumi/core-client";
import { CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { type Dispatch, type SetStateAction, useState } from "react";
import { toast } from "sonner";
import {
  deleteRoomMessageAction,
  editRoomMessageAction,
  pinRoomMessageAction,
  removeRoomMessageUnfurlAction,
  unpinRoomMessageAction,
} from "@/app/chat/actions";
import { isRoomComposerContentOverLimit } from "@/app/chat/components/room-helpers";
import {
  filterTopLevelChatRoomMessages,
  isTopLevelChatRoomMessage,
} from "@/app/chat/utils/chat-room-message-scope";
import { keepKnownThreadUnreadReplyCount } from "@/app/chat/utils/merge-room-messages";
import { applyReplySoftDeleteToParentIfUnchanged } from "@/app/chat/utils/parent-thread-preview";
import { tombstoneChatRoomMessage } from "@/lib/ably/apply-chat-room-message-id-envelope";

interface RoomMessageMutationsOptions {
  /** Read at call time: the open Room is resolved after this hook runs. */
  getSelectedRoomId: () => string | undefined;
  isStillSelectedRoom: (roomId: string) => boolean;
  messagesState: readonly ChatRoomMessage[];
  setMessagesState: (update: SetStateAction<ChatRoomMessage[]>) => void;
  setThreadMessages: Dispatch<SetStateAction<ChatRoomMessage[]>>;
  threadParentMessage: ChatRoomMessage | null;
  setThreadParentMessage: Dispatch<SetStateAction<ChatRoomMessage | null>>;
}

/** Pin, edit, link-preview removal and delete for the messages of one Room. */
export function useRoomMessageMutations({
  getSelectedRoomId,
  isStillSelectedRoom,
  messagesState,
  setMessagesState,
  setThreadMessages,
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
  const [openUnfurlRemovals] = useState(() => new Set<string>());
  const [openEditSaves] = useState(() => new Set<string>());
  const [pinWrites] = useState(
    () =>
      new Map<
        string,
        { pinned: boolean; echoed: boolean; done: Promise<boolean> }
      >(),
  );

  function mergeUpdatedMessage(answer: ChatRoomMessage) {
    // An answer can still hold the cards whose removal is open.
    const updatedMessage =
      openUnfurlRemovals.size === 0
        ? answer
        : {
            ...answer,
            unfurls:
              answer.unfurls?.filter(
                (unfurl) =>
                  !openUnfurlRemovals.has(`${answer.id} ${unfurl.url}`),
              ) ?? null,
          };
    setMessagesState((current) => {
      // Thread replies never belong in the room list (edit/delete/reaction).
      if (!isTopLevelChatRoomMessage(updatedMessage)) {
        return current.filter((message) => message.id !== updatedMessage.id);
      }
      return filterTopLevelChatRoomMessages(
        current.map((message) =>
          message.id === updatedMessage.id
            ? keepKnownThreadUnreadReplyCount(message, updatedMessage)
            : message,
        ),
      );
    });
    // Parent lives in threadParentMessage only — never in the replies list.
    // Purge any prior leak (e.g. pre-fix Ably merge of the root).
    if (isTopLevelChatRoomMessage(updatedMessage)) {
      setThreadMessages((current) =>
        current.filter((message) => message.id !== updatedMessage.id),
      );
    } else {
      setThreadMessages((current) =>
        current.map((message) =>
          message.id === updatedMessage.id ? updatedMessage : message,
        ),
      );
    }
    setThreadParentMessage((current) =>
      current?.id === updatedMessage.id ? updatedMessage : current,
    );
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
    write.done = (
      pinned
        ? pinRoomMessageAction(roomId, messageId)
        : unpinRoomMessageAction(roomId, messageId)
    )
      .catch(() => null)
      .then((result) => {
        pinWrites.delete(messageId);
        if (!result?.ok) {
          setRowPinned(messageId, write.echoed ? pinned : !pinned);
          toast.error(
            result?.error.message ??
              t(
                pinned
                  ? "PinnedMessages.pinError"
                  : "PinnedMessages.unpinError",
              ),
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
    // The row shows a text Core does not have yet. A second edit on top of
    // it could put that text back as if it were saved.
    if (openEditSaves.has(message.id)) return;
    setEditSession({ messageId: message.id, draft: message.content, inThread });
  }

  function handleCancelEdit() {
    setEditSession(null);
  }

  function handleEditDraftChange(draft: string) {
    setEditSession((current) => (current ? { ...current, draft } : current));
  }

  function handleSaveEdit(contentOverride?: string) {
    const roomId = getSelectedRoomId();
    if (!roomId || !editSession) return;
    const { messageId, draft } = editSession;
    // Two saves in one tick both see the session open.
    if (openEditSaves.has(messageId)) return;
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

    // The editor closes and the row shows the new text at once. A refused
    // save puts the old text back where the row still carries this edit. The
    // toast offers the editor again with the text the user confirmed: it does
    // not open by itself, because it would take the focus from what the user
    // types by then.
    const { inThread } = editSession;
    const editedAt = new Date();
    let before: Pick<ChatRoomMessage, "content" | "editedAt"> | null = null;
    patchMessage(messageId, (row) => {
      before ??= { content: row.content, editedAt: row.editedAt };
      return { ...row, content, editedAt };
    });
    setEditSession(null);
    openEditSaves.add(messageId);
    void editRoomMessageAction(roomId, messageId, content)
      .catch(() => null)
      .then((result) => {
        openEditSaves.delete(messageId);
        if (!result?.ok) {
          toast.error(result?.error.message ?? t("Edit.saveError"), {
            action: {
              label: t("Edit.action"),
              onClick: () => {
                if (openEditSaves.has(messageId)) return;
                setEditSession(
                  (current) => current ?? { messageId, draft: raw, inThread },
                );
              },
            },
          });
          patchMessage(messageId, (row) =>
            row.editedAt === editedAt && before ? { ...row, ...before } : row,
          );
          return;
        }
        if (!isStillSelectedRoom(roomId)) {
          return;
        }
        mergeUpdatedMessage(result.value);
      });
  }

  /** Changes one message in the room list, the open thread and its parent. */
  function patchMessage(
    messageId: string,
    patch: (row: ChatRoomMessage) => ChatRoomMessage,
  ) {
    const apply = (row: ChatRoomMessage) =>
      row.id === messageId ? patch(row) : row;
    setMessagesState((current) => current.map(apply));
    setThreadMessages((current) => current.map(apply));
    setThreadParentMessage((current) => (current ? apply(current) : current));
  }

  /**
   * The card leaves at once. A refused removal puts it back where it was,
   * into the row as it is by then, so nothing that arrived meanwhile is lost.
   */
  function handleRemoveUnfurl(message: ChatRoomMessage, url: string) {
    const roomId = getSelectedRoomId();
    if (!roomId) {
      return;
    }
    const unfurls = message.unfurls ?? [];
    const laterUrls = unfurls
      .slice(unfurls.findIndex((unfurl) => unfurl.url === url) + 1)
      .map((unfurl) => unfurl.url);
    const removed = unfurls.filter((unfurl) => unfurl.url === url);
    const key = `${message.id} ${url}`;
    openUnfurlRemovals.add(key);
    patchMessage(message.id, (row) => ({
      ...row,
      unfurls: row.unfurls?.filter((unfurl) => unfurl.url !== url) ?? null,
    }));
    void removeRoomMessageUnfurlAction(roomId, message.id, url)
      .catch(() => null)
      .then((result) => {
        openUnfurlRemovals.delete(key);
        if (!result?.ok) {
          toast.error(result?.error.message ?? t("Unfurl.removeError"));
          patchMessage(message.id, (row) => {
            const kept = row.unfurls ?? [];
            if (kept.some((unfurl) => unfurl.url === url)) {
              return row;
            }
            // Before the first card that came after it; else at the end.
            const next = kept.findIndex((unfurl) =>
              laterUrls.includes(unfurl.url),
            );
            const at = next === -1 ? kept.length : next;
            return {
              ...row,
              unfurls: [...kept.slice(0, at), ...removed, ...kept.slice(at)],
            };
          });
          return;
        }
        if (!isStillSelectedRoom(roomId)) {
          return;
        }
        mergeUpdatedMessage(result.value);
      });
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

    // The row shows as deleted at once. A refused delete gives the row back
    // what the tombstone took, unless a full message replaced the tombstone:
    // an update, or Core's own tombstone when only the answer was lost. A
    // field patch (reaction, link preview, mention status) that came for the
    // tombstone is lost with it until the next read.
    const tombstone = tombstoneChatRoomMessage(message);
    mergeUpdatedMessage(tombstone);
    void deleteRoomMessageAction(roomId, message.id)
      .catch(() => null)
      .then((result) => {
        if (!result?.ok) {
          toast.error(result?.error.message ?? t("Message.deleteError"));
          patchMessage(message.id, (row) =>
            row.deletedAt === tombstone.deletedAt
              ? {
                  ...row,
                  content: message.content,
                  deletedAt: message.deletedAt,
                  editedAt: message.editedAt,
                  mentions: message.mentions,
                  reactions: message.reactions,
                  metadata: message.metadata,
                  quote: message.quote,
                  membership: message.membership,
                  unfurls: message.unfurls,
                }
              : row,
          );
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
    // The editor closes when a save starts, so no editor waits on one.
    isSavingEdit: false,
    applyPinnedMutation,
    handlePinMessage,
    handleUnpinFromPanel,
    handleStartEdit,
    handleCancelEdit,
    handleEditDraftChange,
    handleSaveEdit,
    handleRemoveUnfurl,
    handleDeleteMessage,
    mergeUpdatedMessage,
  };
}
