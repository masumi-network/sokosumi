"use client";

import { Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { type RoomComposerHandle } from "./room-composer";
import { RoomFileDropZone } from "./room-file-drop-zone";
import {
  type ChatParticipantHoverProfile,
  isMessageContinuation,
  type PendingRoomQuote,
  type RoomMentionParticipant,
} from "./room-helpers";
import { ChatMessageRow } from "./room-message-row";
import {
  RoomSessionComposer,
  type RoomSessionSendRequest,
  type RoomSessionSendResult,
} from "./room-session-composer";

export function ThreadPanel({
  parentMessage,
  replies,
  isLoading,
  olderNextCursor,
  isLoadingOlder,
  onLoadOlder,
  coworkersById,
  coworkersBySlug,
  usersById,
  usersBySlug,
  mentionRecords,
  draftKey,
  onBeforeSendReply,
  onSendReply,
  isSendingReply,
  onClose,
  onToggleReaction,
  onQuote,
  currentUserId,
  canOpenHumanDirect = false,
  onOpenDirectMessage,
  openingDirectParticipantKey = null,
  onStartEdit,
  onDelete,
  editSession = null,
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
  isSavingEdit = false,
  pendingQuote = null,
  onClearPendingQuote,
  onRestorePendingQuote,
  showMentionShortcut = true,
  allowAttachments = true,
  roomId,
}: {
  parentMessage: ChatRoomMessage;
  replies: ChatRoomMessage[];
  isLoading: boolean;
  olderNextCursor: string | null;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  usersById?: Map<string, Pick<ChatRoomUserParticipant, "id" | "name">>;
  usersBySlug?: Map<string, Pick<ChatRoomUserParticipant, "id" | "name">>;
  mentionRecords: Record<string, MentionRecordEntry<RoomMentionParticipant>>;
  draftKey: string;
  onBeforeSendReply?: (clientMessageId: string) => boolean;
  onSendReply: (
    request: RoomSessionSendRequest,
  ) => Promise<RoomSessionSendResult>;
  isSendingReply: boolean;
  onClose: () => void;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onQuote?: (message: ChatRoomMessage) => void;
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirectMessage?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
  onStartEdit?: (message: ChatRoomMessage) => void;
  onDelete?: (message: ChatRoomMessage) => void;
  editSession?: { messageId: string; draft: string } | null;
  onEditDraftChange?: (value: string) => void;
  onCancelEdit?: () => void;
  onSaveEdit?: () => void;
  isSavingEdit?: boolean;
  pendingQuote?: PendingRoomQuote | null;
  onClearPendingQuote?: () => void;
  onRestorePendingQuote?: (quote: PendingRoomQuote) => void;
  showMentionShortcut?: boolean;
  allowAttachments?: boolean;
  roomId: string;
}) {
  const t = useTranslations("App.Channels");
  const threadComposerRef = useRef<RoomComposerHandle | null>(null);
  const threadBottomRef = useRef<HTMLDivElement | null>(null);

  useMountEffect(() => {
    requestAnimationFrame(() => {
      threadComposerRef.current?.focus();
    });
  });

  function handleQuote(message: ChatRoomMessage) {
    onQuote?.(message);
    requestAnimationFrame(() => {
      threadComposerRef.current?.focus();
    });
  }

  function editPropsFor(messageId: string) {
    const isEditing = editSession?.messageId === messageId;
    return {
      currentUserId,
      onStartEdit,
      onDelete,
      isEditing,
      editDraft: isEditing && editSession ? editSession.draft : "",
      onEditDraftChange,
      onCancelEdit,
      onSaveEdit,
      isSavingEdit: isSavingEdit && isEditing,
    };
  }

  return (
    // Below lg the thread takes over the whole pane: side-by-side would leave
    // the message column ~0px wide and push the panel past the viewport edge,
    // taking its close button with it. It has its own header and close button,
    // so a full-screen takeover is self-contained.
    <aside className="bg-background absolute inset-0 z-30 flex min-h-0 w-full shrink-0 flex-col lg:static lg:z-auto lg:w-[420px] lg:border-l">
      <RoomFileDropZone
        enabled={allowAttachments}
        onFiles={(files) => {
          threadComposerRef.current?.attachFiles(files);
        }}
        label={t("Toolbar.dropToAttach")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              {t("Thread.title")}
            </h2>
            <p className="text-muted-foreground truncate text-xs">
              {t("Thread.replyCount", {
                count: parentMessage.threadReplyCount,
              })}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            aria-label={t("Thread.close")}
            title={t("Thread.close")}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-4 pt-4 pb-0">
            <ChatMessageRow
              message={parentMessage}
              coworkersById={coworkersById}
              coworkersBySlug={coworkersBySlug}
              usersById={usersById}
              usersBySlug={usersBySlug}
              canOpenHumanDirect={canOpenHumanDirect}
              onOpenDirectMessage={onOpenDirectMessage}
              openingDirectParticipantKey={openingDirectParticipantKey}
              onToggleReaction={onToggleReaction}
              onQuote={onQuote ? handleQuote : undefined}
              showThreadButton={false}
              {...editPropsFor(parentMessage.id)}
            />
            <div className="my-4 border-t" />
            {isLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("Thread.loading")}
              </div>
            ) : (
              <>
                {olderNextCursor ? (
                  <div className="mb-3 flex justify-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isLoadingOlder}
                      onClick={onLoadOlder}
                    >
                      {isLoadingOlder ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          {t("loadingOlder")}
                        </>
                      ) : (
                        t("loadOlder")
                      )}
                    </Button>
                  </div>
                ) : null}
                {replies.length > 0 ? (
                  <div className="flex flex-col">
                    {replies.map((reply, index) => (
                      <ChatMessageRow
                        key={reply.id}
                        message={reply}
                        coworkersById={coworkersById}
                        coworkersBySlug={coworkersBySlug}
                        usersById={usersById}
                        usersBySlug={usersBySlug}
                        canOpenHumanDirect={canOpenHumanDirect}
                        onOpenDirectMessage={onOpenDirectMessage}
                        openingDirectParticipantKey={
                          openingDirectParticipantKey
                        }
                        onToggleReaction={onToggleReaction}
                        onQuote={onQuote ? handleQuote : undefined}
                        showThreadButton={false}
                        isContinuation={isMessageContinuation(
                          replies[index - 1],
                          reply,
                        )}
                        {...editPropsFor(reply.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground py-4 text-sm">
                    {t("Thread.empty")}
                  </p>
                )}
                <div ref={threadBottomRef} />
              </>
            )}
          </div>
        </ScrollArea>
        <RoomSessionComposer
          key={draftKey}
          ref={threadComposerRef}
          roomId={roomId}
          draftKey={draftKey}
          mentions={mentionRecords}
          placeholder={t("Thread.replyPlaceholder")}
          isSending={isSendingReply}
          showMentionShortcut={showMentionShortcut}
          allowAttachments={allowAttachments}
          pendingQuote={pendingQuote}
          onClearPendingQuote={onClearPendingQuote}
          onRestorePendingQuote={onRestorePendingQuote}
          onChromeResize={() => {
            threadBottomRef.current?.scrollIntoView({ block: "end" });
          }}
          onBeforeSend={onBeforeSendReply}
          onSend={onSendReply}
        />
      </RoomFileDropZone>
    </aside>
  );
}
