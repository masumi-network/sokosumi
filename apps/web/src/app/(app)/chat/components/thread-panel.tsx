"use client";

import type { ChannelLinkTarget } from "@sokosumi/utils";
import { ChevronLeft, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type RefObject, useMemo, useRef, useState } from "react";
import { CHAT_MESSAGE_LIST_THREAD } from "@/app/chat/chat-message-list";
import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "@/app/chat/chat-message-list-scroller";
import { TranscriptBoundaryRow } from "@/app/chat/components/transcript-boundary-row";
import {
  TranscriptViewport,
  type TranscriptViewportHandle,
} from "@/app/chat/components/transcript-viewport";
import { isCurrentUserMentionerOfFailedShell } from "@/app/chat/utils/coworker-thought";
import type { RoomTranscriptRenderRow } from "@/app/chat/utils/room-transcript-ranges";
import type { ComposerChannelOption } from "@/components/chat/composer-suggestions";
import { Button } from "@/components/ui/button";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea-utils";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  ChatRoomSokoBotParticipant,
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

function buildThreadTranscriptRows(
  parentMessage: ChatRoomMessage,
  replies: readonly ChatRoomMessage[],
  olderNextCursor: string | null,
): RoomTranscriptRenderRow[] {
  const rows: RoomTranscriptRenderRow[] = [
    {
      kind: "message",
      message: parentMessage,
      previousMessage: undefined,
      dayPreviousMessage: undefined,
    },
  ];
  if (olderNextCursor) {
    rows.push({
      kind: "boundary",
      cursorMessageId: olderNextCursor,
      isGap: false,
    });
  }
  let previousReply: ChatRoomMessage | undefined;
  for (const reply of replies) {
    rows.push({
      kind: "message",
      message: reply,
      previousMessage: previousReply,
      dayPreviousMessage: previousReply,
    });
    previousReply = reply;
  }
  return rows;
}

export function ThreadPanel({
  parentMessage,
  replies,
  isLoading,
  olderNextCursor,
  isLoadingOlder,
  onLoadOlder,
  coworkersById,
  coworkersBySlug,
  sokoBotsById,
  sokoBotsBySlug,
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
  onJumpToQuotedMessage,
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
  holdOffBottom = false,
  composerDisabledMessage,
  viewportRef: viewportRefFromParent,
}: {
  parentMessage: ChatRoomMessage;
  replies: ChatRoomMessage[];
  isLoading: boolean;
  olderNextCursor: string | null;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  sokoBotsById?: Map<string, ChatRoomSokoBotParticipant>;
  sokoBotsBySlug?: Map<string, ChatRoomSokoBotParticipant>;
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
  onJumpToQuotedMessage?: (messageId: string) => void;
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
  holdOffBottom?: boolean;
  composerDisabledMessage?: string;
  viewportRef?: RefObject<TranscriptViewportHandle | null>;
}) {
  const t = useTranslations("App.Channels");
  const threadComposerRef = useRef<RoomComposerHandle | null>(null);
  const localViewportRef = useRef<TranscriptViewportHandle | null>(null);
  const viewportRef = viewportRefFromParent ?? localViewportRef;
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const transcriptRows = useMemo(
    () =>
      buildThreadTranscriptRows(
        parentMessage,
        isLoading ? [] : replies,
        isLoading ? null : olderNextCursor,
      ),
    [isLoading, olderNextCursor, parentMessage, replies],
  );

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
      viewportRef.current?.pinToBottomAfterOwnSend();
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

  function renderThreadRow(row: RoomTranscriptRenderRow) {
    if (row.kind === "boundary") {
      return (
        <div className="min-w-0 flow-root">
          <TranscriptBoundaryRow
            cursorMessageId={row.cursorMessageId}
            isGap={row.isGap}
            status={isLoadingOlder ? "loading" : "idle"}
            onLoad={onLoadOlder}
          />
        </div>
      );
    }
    const { message, previousMessage } = row;
    const isParent = message.id === parentMessage.id;
    return (
      <div className="min-w-0 flow-root">
        {message.membership != null ? (
          <MembershipStatusRow message={message} />
        ) : (
          <ChatMessageRow
            message={message}
            coworkersById={coworkersById}
            coworkersBySlug={coworkersBySlug}
            sokoBotsById={sokoBotsById}
            sokoBotsBySlug={sokoBotsBySlug}
            usersById={usersById}
            usersBySlug={usersBySlug}
            mentions={mentionRecords}
            channels={channelOptions}
            channelLinks={channelLinks}
            canOpenHumanDirect={canOpenHumanDirect}
            onOpenDirectMessage={onOpenDirectMessage}
            openingDirectParticipantKey={openingDirectParticipantKey}
            onToggleReaction={onToggleReaction}
            onQuote={onQuote ? handleQuote : undefined}
            onRetryOutbound={isParent ? undefined : onRetryOutbound}
            onRetryMention={retryMentionFor(message)}
            onRemoveOutbound={isParent ? undefined : onRemoveOutbound}
            onJumpToQuotedMessage={onJumpToQuotedMessage}
            showOutboundSentTick={
              isParent ? undefined : outboundSentTickIds?.has(message.id)
            }
            showThreadButton={false}
            reserveHoverActionGutter={false}
            isContinuation={
              isParent ? false : isMessageContinuation(previousMessage, message)
            }
            {...editPropsFor(message.id)}
          />
        )}
        {isParent ? <div className="my-4 border-t" /> : null}
      </div>
    );
  }

  return (
    // Below lg the thread takes over the whole pane: side-by-side would leave
    // the message column ~0px wide and push the panel past the viewport edge,
    // taking its close button with it. It has its own header and close button,
    // so a full-screen takeover is self-contained.
    <aside className="bg-background absolute inset-0 z-30 flex min-h-0 w-full shrink-0 flex-col lg:static lg:z-auto lg:w-[420px] lg:border-l">
      <RoomFileDropZone
        enabled={allowAttachments && !composerDisabledMessage}
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
        <div ref={setScroller} className={CHAT_MESSAGE_LIST_SCROLLER_CLASS}>
          <div
            // A jump can land in a thread too, so the spotlight in globals.css
            // scopes to this list the same way it does the room transcript.
            // Named so a room-scoped lookup does not find this copy of a
            // message id the transcript also renders.
            data-chat-message-list={CHAT_MESSAGE_LIST_THREAD}
            className="flex min-h-full min-w-0 w-full flex-col justify-end px-4 pt-4 pb-0"
          >
            <TranscriptViewport
              key={parentMessage.id}
              ref={viewportRef}
              scroller={scroller}
              rows={transcriptRows}
              renderRow={renderThreadRow}
              list={CHAT_MESSAGE_LIST_THREAD}
              holdOffBottom={holdOffBottom}
            />
            {isLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("Thread.loading")}
              </div>
            ) : replies.length === 0 ? (
              <p className="text-muted-foreground py-4 text-sm">
                {t("Thread.empty")}
              </p>
            ) : null}
          </div>
        </div>
        {composerDisabledMessage ? (
          <p className="text-muted-foreground px-4 py-3 text-sm">
            {composerDisabledMessage}
          </p>
        ) : (
          <RoomSessionComposer
            key={draftKey}
            ref={threadComposerRef}
            roomId={roomId}
            draftKey={draftKey}
            mentions={mentionRecords}
            usersById={usersById}
            usersBySlug={usersBySlug}
            coworkersById={coworkersById}
            coworkersBySlug={coworkersBySlug}
            sokoBotsById={sokoBotsById}
            sokoBotsBySlug={sokoBotsBySlug}
            channels={channelOptions}
            channelLinks={channelLinks}
            placeholder={t("Thread.replyPlaceholder")}
            isSending={isSendingReply}
            showMentionShortcut={showMentionShortcut}
            allowAttachments={allowAttachments}
            pendingQuote={pendingQuote}
            onClearPendingQuote={onClearPendingQuote}
            onRestorePendingQuote={onRestorePendingQuote}
            onChromeResize={() => {
              viewportRef.current?.scrollToBottomIfPinned();
            }}
            onBeforeSend={onBeforeSendReply}
            onSend={handleSendReply}
            currentUserId={currentUserId}
            canOpenHumanDirect={canOpenHumanDirect}
            onOpenDirectMessage={onOpenDirectMessage}
            openingDirectParticipantKey={openingDirectParticipantKey}
          />
        )}
      </RoomFileDropZone>
    </aside>
  );
}
