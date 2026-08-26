"use client";

import {
  type ChannelLinkTarget,
  formatTaskAttachmentMarkdown,
} from "@sokosumi/utils";
import {
  type FormEvent,
  type Ref,
  useCallback,
  useMemo,
  useState,
} from "react";

import { usePersistComposeDraft } from "@/app/chat/hooks/use-compose-draft";
import {
  type ComposeDraft,
  clearComposeDraft,
} from "@/app/chat/utils/compose-draft-storage";
import type { ComposerChannelOption } from "@/components/chat/composer-suggestions";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea";

import {
  RoomComposer,
  type RoomComposerAttachment,
  type RoomComposerHandle,
} from "./room-composer";
import {
  buildRoomComposerMessageContent,
  type ChatParticipantHoverProfile,
  isRoomComposerEmpty,
  type PendingRoomQuote,
  type RoomMentionParticipant,
} from "./room-helpers";

export interface RoomSessionSendRequest {
  content: string;
  mentionedIds: string[];
  quote?: { messageId: string };
  clientMessageId: string;
}

export interface RoomSessionSendResult {
  ok: boolean;
  message?: string;
}

interface ComposerSnapshot {
  value: string;
  attachments: RoomComposerAttachment[];
  mentionedIds: string[];
  pendingQuote: PendingRoomQuote | null;
}

interface RoomSessionComposerProps {
  roomId: string;
  draftKey: string;
  mentions: Record<string, MentionRecordEntry<RoomMentionParticipant>>;
  channels?: readonly ComposerChannelOption[];
  channelLinks?: readonly ChannelLinkTarget[];
  placeholder: string;
  pendingQuote: PendingRoomQuote | null;
  onClearPendingQuote?: () => void;
  onRestorePendingQuote?: (quote: PendingRoomQuote) => void;
  isSending: boolean;
  showMentionShortcut?: boolean;
  allowAttachments?: boolean;
  onChromeResize?: () => void;
  /**
   * Autofocus editor. Progressive room open keeps this false while history is
   * pending so Instant→shell does not open the OSK / jump selection early.
   */
  focusOnMount?: boolean;
  ref?: Ref<RoomComposerHandle>;
  /** Claim in-flight lock with clientMessageId; return false to abort clear. */
  onBeforeSend?: (clientMessageId: string) => boolean;
  onSend: (request: RoomSessionSendRequest) => Promise<RoomSessionSendResult>;
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirectMessage?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
}

/** Draft state lives here so room message lists do not re-render on typing. */
export function RoomSessionComposer({
  roomId,
  draftKey,
  mentions,
  channels,
  channelLinks,
  placeholder,
  pendingQuote,
  onClearPendingQuote,
  onRestorePendingQuote,
  isSending,
  showMentionShortcut,
  allowAttachments,
  onChromeResize,
  focusOnMount = true,
  ref,
  onBeforeSend,
  onSend,
  currentUserId,
  canOpenHumanDirect,
  onOpenDirectMessage,
  openingDirectParticipantKey,
}: RoomSessionComposerProps) {
  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<
    RoomComposerAttachment[]
  >([]);
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);

  const composeDraft = useMemo<ComposeDraft>(
    () => ({
      text: composerValue,
      attachments: composerAttachments.map((attachment) => ({
        url: attachment.url,
        fileName: attachment.fileName,
        ...(attachment.mediaType ? { mediaType: attachment.mediaType } : {}),
      })),
    }),
    [composerValue, composerAttachments],
  );

  const { clearDraft } = usePersistComposeDraft({
    key: draftKey,
    draft: composeDraft,
    onHydrate: (draft) => {
      // Prefer persisted compose draft when non-empty; keep mount prefill otherwise.
      if (draft.text || draft.attachments.length > 0) {
        setComposerValue(draft.text);
        setComposerAttachments(
          draft.attachments.map((attachment) => ({
            url: attachment.url,
            fileName: attachment.fileName,
            mediaType: attachment.mediaType ?? null,
          })),
        );
      }
    },
  });

  const restoreSnapshot = useCallback(
    (snapshot: ComposerSnapshot) => {
      setComposerValue(snapshot.value);
      setComposerAttachments(snapshot.attachments);
      setMentionedIds(snapshot.mentionedIds);
      if (snapshot.pendingQuote) {
        onRestorePendingQuote?.(snapshot.pendingQuote);
      }
    },
    [onRestorePendingQuote],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = buildRoomComposerMessageContent(
      composerValue,
      composerAttachments,
      formatTaskAttachmentMarkdown,
    );
    if (!content) return;

    const quotePayload = pendingQuote
      ? { messageId: pendingQuote.messageId }
      : undefined;
    const clientMessageId = crypto.randomUUID();
    if (onBeforeSend && !onBeforeSend(clientMessageId)) return;

    const snapshot: ComposerSnapshot = {
      value: composerValue,
      attachments: composerAttachments,
      mentionedIds,
      pendingQuote,
    };
    const sentDraftKey = draftKey;

    setComposerValue("");
    setComposerAttachments([]);
    setMentionedIds([]);
    onClearPendingQuote?.();
    clearDraft();

    const result = await onSend({
      content,
      mentionedIds: snapshot.mentionedIds,
      quote: quotePayload,
      clientMessageId,
    });

    if (!result.ok) {
      restoreSnapshot(snapshot);
      return;
    }

    clearComposeDraft(sentDraftKey);
  }

  return (
    <RoomComposer
      ref={ref}
      roomId={roomId}
      value={composerValue}
      onValueChange={setComposerValue}
      mentions={mentions}
      channels={channels}
      channelLinks={channelLinks}
      onSelectedKeysChange={setMentionedIds}
      placeholder={placeholder}
      attachments={composerAttachments}
      onAttachmentsChange={setComposerAttachments}
      onSubmit={handleSubmit}
      isSending={isSending}
      sendDisabled={isRoomComposerEmpty(composerValue, composerAttachments)}
      showMentionShortcut={showMentionShortcut}
      allowAttachments={allowAttachments}
      pendingQuote={pendingQuote}
      onClearPendingQuote={onClearPendingQuote}
      onChromeResize={onChromeResize}
      focusOnMount={focusOnMount}
      currentUserId={currentUserId}
      canOpenHumanDirect={canOpenHumanDirect}
      onOpenDirectMessage={onOpenDirectMessage}
      openingDirectParticipantKey={openingDirectParticipantKey}
    />
  );
}
