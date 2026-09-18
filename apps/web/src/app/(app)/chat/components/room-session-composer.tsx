"use client";

import {
  CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
  type ChannelLinkTarget,
  formatTaskAttachmentMarkdown,
} from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import {
  type ClipboardEvent,
  type FormEvent,
  type Ref,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { usePersistComposeDraft } from "@/app/chat/hooks/use-compose-draft";
import {
  type ComposeDraft,
  clearComposeDraft,
} from "@/app/chat/utils/compose-draft-storage";
import type { ComposerChannelOption } from "@/components/chat/composer-suggestions";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea-utils";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomSokoBotParticipant,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import {
  type ChatRoomMessageLink,
  parseChatRoomMessageLink,
} from "@/lib/utils/notification-href";

import {
  RoomComposer,
  type RoomComposerAttachment,
  type RoomComposerEditHandle,
  type RoomComposerHandle,
} from "./room-composer";
import {
  buildRoomComposerMessageContent,
  type ChatParticipantHoverProfile,
  isRoomComposerContentOverLimit,
  isRoomComposerEmpty,
  type PendingRoomQuote,
  type RoomMentionParticipant,
} from "./room-helpers";

export interface RoomSessionSendRequest {
  content: string;
  /** Chips at send time; content already carries their markdown links. */
  attachments: RoomComposerAttachment[];
  mentionedIds: string[];
  quote?: { messageId: string; roomId?: string };
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

/** A pasted Message link that became the pending quote. */
interface QuotedLink {
  messageId: string;
  linkText: string;
}

interface RoomSessionComposerProps {
  roomId: string;
  draftKey: string;
  mentions: Record<string, MentionRecordEntry<RoomMentionParticipant>>;
  usersById?: Map<string, Pick<ChatRoomUserParticipant, "id" | "name">>;
  usersBySlug?: Map<string, Pick<ChatRoomUserParticipant, "id" | "name">>;
  coworkersById?: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug?: Map<string, ChatRoomCoworkerParticipant>;
  sokoBotsById?: Map<string, ChatRoomSokoBotParticipant>;
  sokoBotsBySlug?: Map<string, ChatRoomSokoBotParticipant>;
  channels?: readonly ComposerChannelOption[];
  channelLinks?: readonly ChannelLinkTarget[];
  placeholder: string;
  pendingQuote: PendingRoomQuote | null;
  onClearPendingQuote?: () => void;
  onSetPendingQuote?: (quote: PendingRoomQuote) => void;
  /**
   * Resolve a pasted Message link into a quote the sender may send here, or
   * null when it must stay a plain link.
   */
  onResolveMessageLink?: (
    link: ChatRoomMessageLink,
  ) => Promise<PendingRoomQuote | null>;
  isSending: boolean;
  showMentionShortcut?: boolean;
  allowAttachments?: boolean;
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
  usersById,
  usersBySlug,
  coworkersById,
  coworkersBySlug,
  sokoBotsById,
  sokoBotsBySlug,
  channels,
  channelLinks,
  placeholder,
  pendingQuote,
  onClearPendingQuote,
  onSetPendingQuote,
  onResolveMessageLink,
  isSending,
  showMentionShortcut,
  allowAttachments,
  focusOnMount = true,
  ref,
  onBeforeSend,
  onSend,
  currentUserId,
  canOpenHumanDirect,
  onOpenDirectMessage,
  openingDirectParticipantKey,
}: RoomSessionComposerProps) {
  const t = useTranslations("App.Channels");
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
        onSetPendingQuote?.(snapshot.pendingQuote);
      }
    },
    [onSetPendingQuote],
  );

  // The pasted link the pending quote replaced, so removing that quote can put
  // the link back as plain text.
  const [quotedLink, setQuotedLink] = useState<QuotedLink | null>(null);
  // What the sender is looking at now, for a quote that resolves after they
  // edited the link away, pasted again, sent, or moved to another room.
  const latest = useRef({ draftKey, pendingQuote, paste: 0 });
  latest.current = { ...latest.current, draftKey, pendingQuote };

  const composerRef = useRef<RoomComposerEditHandle | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      attachFiles: (files) => composerRef.current?.attachFiles(files),
      focus: () => composerRef.current?.focus(),
    }),
    [],
  );

  async function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    latest.current.paste += 1;
    const paste = latest.current.paste;
    // One quote per message: never swap a quote the sender already chose.
    if (!onResolveMessageLink || pendingQuote) return;

    const linkText = event.clipboardData.getData("text/plain").trim();
    const link = parseChatRoomMessageLink(linkText, window.location.origin);
    if (!link) return;

    const quote = await onResolveMessageLink(link).catch(() => null);
    const now = latest.current;
    if (
      !quote ||
      paste !== now.paste ||
      now.draftKey !== draftKey ||
      now.pendingQuote
    ) {
      return;
    }

    // Removed in the editor itself: a focused editor keeps its own text and
    // caret, so the sender's words around the link stay as typed. Nothing to
    // swap once the link was edited away.
    if (!composerRef.current?.removeLastText(linkText)) return;
    onSetPendingQuote?.(quote);
    setQuotedLink({ messageId: quote.messageId, linkText });
  }

  function handleClearPendingQuote() {
    if (quotedLink && quotedLink.messageId === pendingQuote?.messageId) {
      composerRef.current?.insertText(
        composerValue.trim().length === 0
          ? quotedLink.linkText
          : ` ${quotedLink.linkText}`,
      );
    }
    setQuotedLink(null);
    onClearPendingQuote?.();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = buildRoomComposerMessageContent(
      composerValue,
      composerAttachments,
      formatTaskAttachmentMarkdown,
    );
    if (!content && !pendingQuote) return;
    if (isRoomComposerContentOverLimit(content)) {
      toast.error(
        t("composerTooLong", {
          count: content.length,
          max: CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
        }),
      );
      return;
    }

    const quotePayload = pendingQuote
      ? {
          messageId: pendingQuote.messageId,
          ...(pendingQuote.roomId ? { roomId: pendingQuote.roomId } : {}),
        }
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
    latest.current.paste += 1;
    setQuotedLink(null);
    clearDraft();

    const result = await onSend({
      content,
      attachments: snapshot.attachments,
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
    // Text pastes bubble here after the editor inserted them as plain text.
    <div className="contents" onPaste={(event) => void handlePaste(event)}>
      <RoomComposer
        ref={composerRef}
        roomId={roomId}
        value={composerValue}
        onValueChange={setComposerValue}
        mentions={mentions}
        usersById={usersById}
        usersBySlug={usersBySlug}
        coworkersById={coworkersById}
        coworkersBySlug={coworkersBySlug}
        sokoBotsById={sokoBotsById}
        sokoBotsBySlug={sokoBotsBySlug}
        channels={channels}
        channelLinks={channelLinks}
        onSelectedKeysChange={setMentionedIds}
        placeholder={placeholder}
        attachments={composerAttachments}
        onAttachmentsChange={setComposerAttachments}
        onSubmit={handleSubmit}
        isSending={isSending}
        sendDisabled={
          isRoomComposerEmpty(composerValue, composerAttachments) &&
          !pendingQuote
        }
        showMentionShortcut={showMentionShortcut}
        allowAttachments={allowAttachments}
        pendingQuote={pendingQuote}
        onClearPendingQuote={
          onClearPendingQuote ? handleClearPendingQuote : undefined
        }
        focusOnMount={focusOnMount}
        currentUserId={currentUserId}
        canOpenHumanDirect={canOpenHumanDirect}
        onOpenDirectMessage={onOpenDirectMessage}
        openingDirectParticipantKey={openingDirectParticipantKey}
      />
    </div>
  );
}
