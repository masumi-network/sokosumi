"use client";

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
import type { MentionRecordEntry } from "@/components/ui/mention-textarea";
import { formatTaskAttachmentMarkdown } from "@/lib/utils/task-attachments";

import {
  RoomComposer,
  type RoomComposerAttachment,
  type RoomComposerHandle,
} from "./room-composer";
import {
  buildRoomComposerMessageContent,
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
  placeholder: string;
  pendingQuote: PendingRoomQuote | null;
  onClearPendingQuote?: () => void;
  onRestorePendingQuote?: (quote: PendingRoomQuote) => void;
  isSending: boolean;
  showMentionShortcut?: boolean;
  allowAttachments?: boolean;
  onChromeResize?: () => void;
  ref?: Ref<RoomComposerHandle>;
  /** Claim in-flight lock with clientMessageId; return false to abort clear. */
  onBeforeSend?: (clientMessageId: string) => boolean;
  onSend: (request: RoomSessionSendRequest) => Promise<RoomSessionSendResult>;
}

/** Draft state lives here so room message lists do not re-render on typing. */
export function RoomSessionComposer({
  roomId,
  draftKey,
  mentions,
  placeholder,
  pendingQuote,
  onClearPendingQuote,
  onRestorePendingQuote,
  isSending,
  showMentionShortcut,
  allowAttachments,
  onChromeResize,
  ref,
  onBeforeSend,
  onSend,
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
      setComposerValue(draft.text);
      setComposerAttachments(
        draft.attachments.map((attachment) => ({
          url: attachment.url,
          fileName: attachment.fileName,
          mediaType: attachment.mediaType ?? null,
        })),
      );
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
    />
  );
}
