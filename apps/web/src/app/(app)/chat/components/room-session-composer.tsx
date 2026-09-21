"use client";

import {
  CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
  type ChannelLinkTarget,
  formatTaskAttachmentMarkdown,
} from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import {
  type ClipboardEvent,
  type Dispatch,
  type FormEvent,
  type Ref,
  type SetStateAction,
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
import { RoomTypingLine } from "./room-typing-line";
import { useRoomTypingContext } from "./room-typing-provider";

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
  quotedLink: QuotedLink | null;
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
  /**
   * True where a quote cannot be the whole message: the coworker 1:1 stream
   * needs words to answer.
   */
  requireBody?: boolean;
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
  requireBody = false,
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
  // Inert unless a RoomTypingProvider is mounted around this composer, which
  // is how the Thread composer stays silent (ADR-0033).
  const {
    enabled: typingEnabled,
    typistIds,
    handleComposerChange,
    handleStopTyping,
  } = useRoomTypingContext();
  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<
    RoomComposerAttachment[]
  >([]);
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  /** Set while a toolbar control inserts text, so it is not read as typing. */
  const toolbarInsertRef = useRef(false);

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

  /**
   * Genuine composer input only. Draft hydrate and failed-send restore set
   * `composerValue` directly, so neither announces Typing — which is what
   * keeps opening a room you abandoned a Draft in silent.
   */
  const handleComposerValueChange = useCallback<
    Dispatch<SetStateAction<string>>
  >(
    (action) => {
      setComposerValue(action);
      if (typeof action !== "string") {
        return;
      }
      // An emoji the toolbar dropped in is not text the person typed, so it
      // must not announce Typing (ADR-0033).
      if (toolbarInsertRef.current) {
        toolbarInsertRef.current = false;
        return;
      }
      handleComposerChange(action.trim().length > 0);
    },
    [handleComposerChange],
  );

  const handleToolbarInsert = useCallback(() => {
    toolbarInsertRef.current = true;
    // The insert dispatches its input event synchronously, so only a change in
    // this task may claim the flag. Clearing it straight after stops a failed
    // or no-op insert from leaving the flag set and swallowing the next real
    // keystroke. Failing this way announces Typing once too often rather than
    // going silent when somebody is genuinely typing.
    queueMicrotask(() => {
      toolbarInsertRef.current = false;
    });
  }, []);

  // The pasted link the pending quote replaced, so removing that quote can put
  // the link back as plain text.
  const [quotedLink, setQuotedLink] = useState<QuotedLink | null>(null);

  const restoreSnapshot = useCallback(
    (snapshot: ComposerSnapshot) => {
      setComposerValue(snapshot.value);
      setComposerAttachments(snapshot.attachments);
      setMentionedIds(snapshot.mentionedIds);
      if (snapshot.pendingQuote) {
        onSetPendingQuote?.(snapshot.pendingQuote);
        setQuotedLink(snapshot.quotedLink);
      }
    },
    [onSetPendingQuote],
  );

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
      // Putting the link back is the app restoring text, not the person
      // typing it, so it must not announce Typing (ADR-0033).
      handleToolbarInsert();
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
    if (!content && (requireBody || !pendingQuote)) return;
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
      quotedLink,
    };
    const sentDraftKey = draftKey;

    setComposerValue("");
    setComposerAttachments([]);
    setMentionedIds([]);
    onClearPendingQuote?.();
    latest.current.paste += 1;
    setQuotedLink(null);
    clearDraft();
    // The message has arrived, so the line must not outlive what it promised.
    handleStopTyping();

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
    // `contents` keeps the Typing line a layout sibling of the composer card.
    <div className="contents" onPaste={(event) => void handlePaste(event)}>
      <RoomComposer
        ref={composerRef}
        typingLine={
          typingEnabled ? (
            <RoomTypingLine typistIds={typistIds} usersById={usersById} />
          ) : null
        }
        roomId={roomId}
        value={composerValue}
        onValueChange={handleComposerValueChange}
        onEditorBlur={handleStopTyping}
        onToolbarInsert={handleToolbarInsert}
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
          (requireBody || !pendingQuote)
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
