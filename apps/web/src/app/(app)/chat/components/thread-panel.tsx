"use client";

import type { ChannelLinkTarget } from "@sokosumi/utils";
import { ChevronLeft, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "@/app/chat/chat-message-list-scroller";
import { useStickToBottom } from "@/app/chat/hooks/use-stick-to-bottom";
import { isCurrentUserMentionerOfFailedShell } from "@/app/chat/utils/coworker-thought";
import { readClientTurnId } from "@/app/chat/utils/outbound-room-message";
import type { ComposerChannelOption } from "@/components/chat/composer-suggestions";
import { Button } from "@/components/ui/button";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { MembershipStatusRow } from "./membership-status-row";
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
  channelOptions = [],
  channelLinks = [],
  draftKey,
  onBeforeSendReply,
  onSendReply,
  isSendingReply,
  onBack,
  onClose,
  onToggleReaction,
  onQuote,
  currentUserId,
  canOpenHumanDirect = false,
  onOpenDirectMessage,
  openingDirectParticipantKey = null,
  onStartEdit,
  onDelete,
  onRemoveUnfurl,
  onRetryOutbound,
  onRetryMention,
  onRemoveOutbound,
  outboundSentTickIds,
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
  channelOptions?: readonly ComposerChannelOption[];
  channelLinks?: readonly ChannelLinkTarget[];
  draftKey: string;
  onBeforeSendReply?: (clientMessageId: string) => boolean;
  onSendReply: (
    request: RoomSessionSendRequest,
  ) => Promise<RoomSessionSendResult>;
  isSendingReply: boolean;
  onBack?: () => void;
  onClose: () => void;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onQuote?: (message: ChatRoomMessage) => void;
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirectMessage?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
  onStartEdit?: (message: ChatRoomMessage) => void;
  onDelete?: (message: ChatRoomMessage) => void;
  onRemoveUnfurl?: (message: ChatRoomMessage, url: string) => void;
  onRetryOutbound?: (message: ChatRoomMessage) => void;
  onRetryMention?: (message: ChatRoomMessage) => void;
  onRemoveOutbound?: (message: ChatRoomMessage) => void;
  outboundSentTickIds?: ReadonlySet<string>;
  editSession?: { messageId: string; draft: string } | null;
  onEditDraftChange?: (value: string) => void;
  onCancelEdit?: () => void;
  onSaveEdit?: (content?: string) => void;
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
  const {
    scrollerRef,
    contentRef,
    contentMinHeight,
    pinToBottomAfterOwnSend,
    scrollToBottomIfPinned,
  } = useStickToBottom({
    resetKey: parentMessage.id,
  });

  function handleQuote(message: ChatRoomMessage) {
    onQuote?.(message);
    requestAnimationFrame(() => {
      threadComposerRef.current?.focus();
    });
  }

  async function handleSendReply(
    request: RoomSessionSendRequest,
  ): Promise<RoomSessionSendResult> {
    const result = await onSendReply(request);
    if (result.ok) {
      pinToBottomAfterOwnSend();
    }
    return result;
  }

  const mentionRetrySourceMessages = [parentMessage, ...replies];

  function retryMentionFor(message: ChatRoomMessage) {
    return isCurrentUserMentionerOfFailedShell({
      shell: message,
      currentUserId,
      sourceMessages: mentionRetrySourceMessages,
    })
      ? onRetryMention
      : undefined;
  }

  function editPropsFor(messageId: string) {
    const isEditing = editSession?.messageId === messageId;
    return {
      currentUserId,
      onStartEdit,
      onDelete,
      onRemoveUnfurl,
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
          {onBack ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-full"
              aria-label={t("Thread.back")}
              title={t("Thread.back")}
              onClick={onBack}
              data-testid="thread-panel-back"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
          ) : (
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
          )}
        </header>
        <div ref={scrollerRef} className={CHAT_MESSAGE_LIST_SCROLLER_CLASS}>
          <div
            ref={contentRef}
            className="flex min-w-0 w-full flex-col justify-end px-4 pt-4 pb-0"
            style={
              contentMinHeight != null
                ? { minHeight: contentMinHeight }
                : undefined
            }
          >
            {parentMessage.membership != null ? (
              <MembershipStatusRow message={parentMessage} />
            ) : (
              <ChatMessageRow
                message={parentMessage}
                coworkersById={coworkersById}
                coworkersBySlug={coworkersBySlug}
                usersById={usersById}
                usersBySlug={usersBySlug}
                channelLinks={channelLinks}
                canOpenHumanDirect={canOpenHumanDirect}
                onOpenDirectMessage={onOpenDirectMessage}
                openingDirectParticipantKey={openingDirectParticipantKey}
                onToggleReaction={onToggleReaction}
                onQuote={onQuote ? handleQuote : undefined}
                onRetryMention={retryMentionFor(parentMessage)}
                showThreadButton={false}
                reserveHoverActionGutter={false}
                {...editPropsFor(parentMessage.id)}
              />
            )}
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
                    {replies.map((reply, index) =>
                      reply.membership != null ? (
                        <MembershipStatusRow key={reply.id} message={reply} />
                      ) : (
                        <ChatMessageRow
                          key={readClientTurnId(reply) ?? reply.id}
                          message={reply}
                          coworkersById={coworkersById}
                          coworkersBySlug={coworkersBySlug}
                          usersById={usersById}
                          usersBySlug={usersBySlug}
                          channelLinks={channelLinks}
                          canOpenHumanDirect={canOpenHumanDirect}
                          onOpenDirectMessage={onOpenDirectMessage}
                          openingDirectParticipantKey={
                            openingDirectParticipantKey
                          }
                          onToggleReaction={onToggleReaction}
                          onQuote={onQuote ? handleQuote : undefined}
                          onRetryOutbound={onRetryOutbound}
                          onRetryMention={retryMentionFor(reply)}
                          onRemoveOutbound={onRemoveOutbound}
                          showOutboundSentTick={outboundSentTickIds?.has(
                            reply.id,
                          )}
                          showThreadButton={false}
                          reserveHoverActionGutter={false}
                          isContinuation={isMessageContinuation(
                            replies[index - 1],
                            reply,
                          )}
                          {...editPropsFor(reply.id)}
                        />
                      ),
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground py-4 text-sm">
                    {t("Thread.empty")}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        <RoomSessionComposer
          key={draftKey}
          ref={threadComposerRef}
          roomId={roomId}
          draftKey={draftKey}
          mentions={mentionRecords}
          channels={channelOptions}
          channelLinks={channelLinks}
          placeholder={t("Thread.replyPlaceholder")}
          isSending={isSendingReply}
          showMentionShortcut={showMentionShortcut}
          allowAttachments={allowAttachments}
          pendingQuote={pendingQuote}
          onClearPendingQuote={onClearPendingQuote}
          onRestorePendingQuote={onRestorePendingQuote}
          onChromeResize={scrollToBottomIfPinned}
          onBeforeSend={onBeforeSendReply}
          onSend={handleSendReply}
          currentUserId={currentUserId}
          canOpenHumanDirect={canOpenHumanDirect}
          onOpenDirectMessage={onOpenDirectMessage}
        />
      </RoomFileDropZone>
    </aside>
  );
}
