"use client";

import type {
  ChatRoomCoworkerParticipant,
  ChatRoomMessageSkill,
  ChatRoomSokoBotParticipant,
  DriveFile,
} from "@sokosumi/core-client";
import {
  CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
  type ChannelLinkTarget,
  formatTaskAttachmentMarkdown,
} from "@sokosumi/utils";
import {
  ALargeSmall,
  AtSign,
  FileText,
  Paperclip,
  Users,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type Ref,
  type SetStateAction,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { getTaskAttachmentUploadLabelTemplate } from "@/app/tasks/components/task-attachment-upload-labels";
import { ComposerAddLinkDialog } from "@/components/chat/composer-add-link-dialog";
import { ComposerFormatToolbar } from "@/components/chat/composer-format-toolbar";
import type { ComposerChannelOption } from "@/components/chat/composer-suggestions";
import {
  ComposerWysiwygEditor,
  type ComposerWysiwygEditorHandle,
} from "@/components/chat/composer-wysiwyg-editor";
import { DictationButton } from "@/components/chat/dictation-button";
import {
  ROOM_COMPOSER_TEXTAREA_CLASSNAME,
  ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME,
  RoomComposerEmojiPicker,
  RoomMessageComposer,
  type RoomMessageComposerAttachment,
} from "@/components/chat/room-message-composer";
import { ComposerSkillChips } from "@/components/chat/skill-chip";
import { SkillPicker } from "@/components/chat/skill-picker";
import { StickerPicker } from "@/components/chat/sticker-picker";
import { AttachmentSubmenu } from "@/components/drive/attachment-submenu";
import { DriveFilePicker } from "@/components/drive/drive-file-picker";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FileChipMiniPreview } from "@/components/ui/file-chip-mini-preview";
import {
  type MentionRecordEntry,
  type NormalizedMention,
} from "@/components/ui/mention-textarea-utils";
import { useEventListener } from "@/hooks/effects/use-event-listener";
import { useFocusWhen } from "@/hooks/effects/use-focus-when";
import { useFormatToolbarOpenPreference } from "@/hooks/effects/use-format-toolbar-open-preference";
import { useResizeObserver } from "@/hooks/effects/use-resize-observer";
import { transcribeVoiceRecording } from "@/lib/services/voice-transcription.browser";
import { cn } from "@/lib/utils";
import { uploadComposeAttachments } from "@/lib/utils/compose-upload.client";
import {
  type ComposerActiveFormats,
  type ComposerFormatCommand,
  EMPTY_COMPOSER_ACTIVE_FORMATS,
} from "@/lib/utils/composer-active-formats";
import { getInitials } from "@/lib/utils/text";
import {
  mentionLookupMapsFromCatalog,
  type UserMentionLookup,
} from "./room-composer-mention-lookup";
import { AiCoworkerIcon } from "./room-draft-shared";
import {
  buildRoomComposerMessageContent,
  type ChatParticipantHoverProfile,
  composerMentionDisplayNames,
  createRoomComposerOverflowMarkdownFile,
  isRoomComposerContentCountVisible,
  isRoomComposerContentOverLimit,
  type PendingRoomQuote,
  partitionRoomMentionSuggestions,
  ROOM_QUOTE_CLAMP_CLASSNAME,
  ROOM_QUOTE_MARKDOWN_CLASSNAME,
  type RoomMentionParticipant,
} from "./room-helpers";
import { RoomMessageMarkdown } from "./room-mention-markdown";

export interface RoomComposerAttachment extends RoomMessageComposerAttachment {
  mediaType: string | null;
}

/** Shell drop zones + Quote/Thread callers reuse this surface. */
export interface RoomComposerHandle {
  attachFiles: (files: FileList | File[] | null) => void;
  focus: () => void;
}

/** Edits made in the editor itself, so a focused editor shows them. */
export interface RoomComposerEditHandle extends RoomComposerHandle {
  /** Focus with the caret after the text, to keep typing on from it. */
  focusAtEnd: () => void;
  insertText: (text: string) => void;
  /** Add `text` after the whole draft, with a space after a word. */
  addText: (text: string) => void;
  /** Remove the last occurrence of `text`; false when it is not in the editor. */
  removeLastText: (text: string) => boolean;
}

function RoomMentionSuggestion({
  mention,
}: {
  mention: NormalizedMention<RoomMentionParticipant>;
}) {
  const t = useTranslations("App.Channels");
  const isCoworker = mention.data?.kind === "coworker";
  const isSokoBot = mention.data?.kind === "sokoBot";
  const isAll = mention.data?.kind === "all";
  const displayName = isAll ? t("MentionAll.label") : mention.value;
  return (
    <>
      {isAll ? (
        <div className="bg-muted flex size-6 items-center justify-center rounded-full">
          <Users className="text-muted-foreground size-3.5" aria-hidden />
        </div>
      ) : (
        <Avatar className="size-6">
          <AvatarImage src={mention.data?.image ?? undefined} alt="" />
          <AvatarFallback className="text-2xs">
            {getInitials(mention.value)}
          </AvatarFallback>
        </Avatar>
      )}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{displayName}</span>
          {isCoworker || isSokoBot ? (
            <AiCoworkerIcon
              label={isSokoBot ? t("personalAssistantBadge") : undefined}
            />
          ) : null}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          {mention.data?.kind === "human"
            ? mention.data.email
            : `@${isAll ? displayName : mention.slug}`}
        </div>
      </div>
    </>
  );
}

function PendingQuotePreview({
  quote,
  onDismiss,
  mentions,
  usersById: rosterUsersById,
  usersBySlug: rosterUsersBySlug,
  coworkersById: rosterCoworkersById,
  coworkersBySlug: rosterCoworkersBySlug,
  sokoBotsById: rosterSokoBotsById,
  sokoBotsBySlug: rosterSokoBotsBySlug,
  channelLinks,
  currentUserId,
  canOpenHumanDirect,
  onOpenDirectMessage,
  openingDirectParticipantKey,
}: {
  quote: PendingRoomQuote;
  onDismiss: () => void;
  mentions: Record<string, MentionRecordEntry<RoomMentionParticipant>>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
  coworkersById?: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug?: Map<string, ChatRoomCoworkerParticipant>;
  sokoBotsById?: Map<string, ChatRoomSokoBotParticipant>;
  sokoBotsBySlug?: Map<string, ChatRoomSokoBotParticipant>;
  channelLinks: readonly ChannelLinkTarget[];
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirectMessage?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
}) {
  const t = useTranslations("App.Channels.Quote");
  const {
    coworkersById,
    coworkersBySlug,
    sokoBotsById,
    sokoBotsBySlug,
    usersById,
    usersBySlug,
  } = mentionLookupMapsFromCatalog(mentions, {
    usersById: rosterUsersById,
    usersBySlug: rosterUsersBySlug,
    coworkersById: rosterCoworkersById,
    coworkersBySlug: rosterCoworkersBySlug,
    sokoBotsById: rosterSokoBotsById,
    sokoBotsBySlug: rosterSokoBotsBySlug,
  });

  return (
    <div
      className="border-border bg-card-background flex items-start gap-2 border-b px-3 py-2"
      role="status"
      aria-label={t("previewLabel", { author: quote.authorName })}
    >
      <div className="border-border min-w-0 flex-1 border-l-2 pl-2.5">
        <div className="text-foreground truncate text-xs font-semibold">
          {quote.authorName}
        </div>
        {quote.snippet.trim() ? (
          <div
            className={cn(
              "text-muted-foreground text-xs leading-5",
              ROOM_QUOTE_CLAMP_CLASSNAME,
            )}
          >
            <RoomMessageMarkdown
              content={quote.snippet}
              markdownClassName={ROOM_QUOTE_MARKDOWN_CLASSNAME}
              coworkersById={coworkersById}
              coworkersBySlug={coworkersBySlug}
              sokoBotsById={sokoBotsById}
              sokoBotsBySlug={sokoBotsBySlug}
              usersById={usersById}
              usersBySlug={usersBySlug}
              channelLinks={channelLinks}
              currentUserId={currentUserId}
              canOpenHumanDirect={canOpenHumanDirect}
              onOpenDirectMessage={onOpenDirectMessage}
              openingDirectParticipantKey={openingDirectParticipantKey}
            />
          </div>
        ) : null}
        {quote.attachments.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {quote.attachments.map((attachment) => (
              <FileChipMiniPreview
                key={attachment.url}
                url={attachment.url}
                fileName={attachment.fileName}
                sizeClass="size-10"
                className="shrink-0"
              />
            ))}
          </div>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="hit-area size-7 shrink-0 rounded-full"
        title={t("dismiss")}
        aria-label={t("dismiss")}
        onClick={onDismiss}
      >
        <X className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}

export function RoomComposer({
  ref,
  roomId,
  value,
  onValueChange,
  onEditorBlur,
  typingLine,
  aboveCard,
  onToolbarInsert,
  mentions,
  usersById,
  usersBySlug,
  coworkersById,
  coworkersBySlug,
  sokoBotsById,
  sokoBotsBySlug,
  channels = [],
  channelLinks = [],
  placeholder,
  attachments,
  onAttachmentsChange,
  onSubmit,
  isSending,
  sendDisabled,
  showMentionShortcut = true,
  allowAttachments = true,
  pendingQuote = null,
  onClearPendingQuote,
  focusOnMount = false,
  currentUserId,
  canOpenHumanDirect = false,
  onOpenDirectMessage,
  openingDirectParticipantKey = null,
  skills = [],
  onSkillsChange,
}: {
  ref?: Ref<RoomComposerEditHandle>;
  /** When set, attaches mint via room chat file endpoint. */
  roomId?: string;
  value: string;
  onValueChange: Dispatch<SetStateAction<string>>;
  /** Editor lost focus — one of the four Typing stops (ADR-0033). */
  onEditorBlur?: () => void;
  /** The Typing line, handed through to the composer chrome (ADR-0033). */
  typingLine?: ReactNode;
  aboveCard?: ReactNode;
  /**
   * A toolbar control put text in the editor rather than the person typing it.
   * Fires just before the insertion, so the resulting change can be told apart
   * from a keystroke — Typing is about text the person typed (ADR-0033).
   */
  onToolbarInsert?: () => void;
  mentions: Record<string, MentionRecordEntry<RoomMentionParticipant>>;
  /** Room roster lookups for quote preview / hydrate chips (includes you). */
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
  coworkersById?: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug?: Map<string, ChatRoomCoworkerParticipant>;
  sokoBotsById?: Map<string, ChatRoomSokoBotParticipant>;
  sokoBotsBySlug?: Map<string, ChatRoomSokoBotParticipant>;
  channels?: readonly ComposerChannelOption[];
  channelLinks?: readonly ChannelLinkTarget[];
  placeholder: string;
  attachments: RoomComposerAttachment[];
  onAttachmentsChange: Dispatch<SetStateAction<RoomComposerAttachment[]>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSending: boolean;
  sendDisabled: boolean;
  /** Channels always; direct rooms only when roster has more than two people. */
  showMentionShortcut?: boolean;
  /** Hides the attach tools; every room send path persists attachment markdown. */
  allowAttachments?: boolean;
  /** Slack-like dismissible quote chip above the editor. */
  pendingQuote?: PendingRoomQuote | null;
  onClearPendingQuote?: () => void;
  /** Focus the editor after mount (room/thread open). */
  focusOnMount?: boolean;
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirectMessage?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
  /** skills.sh skills attached to the next message, shown as chips. */
  skills?: readonly ChatRoomMessageSkill[];
  /** Shows the skill button; omit where a send cannot carry skills. */
  onSkillsChange?: (skills: ChatRoomMessageSkill[]) => void;
}) {
  const t = useTranslations("App.Channels");
  const tToolbar = useTranslations("App.Channels.Toolbar");
  const formRef = useRef<HTMLFormElement | null>(null);
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  const attachForm = useCallback((node: HTMLFormElement | null) => {
    formRef.current = node;
    setForm(node);
    if (!node) return;
    return () => {
      formRef.current = null;
      setForm(null);
      document.documentElement.style.removeProperty("--toast-bottom-offset");
    };
  }, []);
  const editorRef = useRef<ComposerWysiwygEditorHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isUploadingFilesRef = useRef(false);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkInitialText, setLinkInitialText] = useState("");
  const [linkInitialUrl, setLinkInitialUrl] = useState("");
  const [formatToolbarOpen, setFormatToolbarOpen] =
    useFormatToolbarOpenPreference();
  const [activeFormats, setActiveFormats] = useState<ComposerActiveFormats>(
    EMPTY_COMPOSER_ACTIVE_FORMATS,
  );
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const composedContent = buildRoomComposerMessageContent(
    value,
    attachments,
    formatTaskAttachmentMarkdown,
  );
  const contentOverLimit = isRoomComposerContentOverLimit(composedContent);
  const showContentCount = isRoomComposerContentCountVisible(composedContent);
  const composerMentions = showMentionShortcut ? mentions : {};
  const mentionDisplay = useMemo(
    () =>
      composerMentionDisplayNames({
        usersById,
        usersBySlug,
        coworkersById,
        coworkersBySlug,
        sokoBotsById,
        sokoBotsBySlug,
        mentionCatalog: mentions,
      }),
    [
      coworkersById,
      coworkersBySlug,
      mentions,
      sokoBotsById,
      sokoBotsBySlug,
      usersById,
      usersBySlug,
    ],
  );

  // Keep toasts just above the composer (incl. mobile keyboard).
  const updateToastOffset = () => {
    if (!form || formRef.current !== form || !form.isConnected) {
      return;
    }
    const top = form.getBoundingClientRect().top;
    document.documentElement.style.setProperty(
      "--toast-bottom-offset",
      `${Math.max(0, window.innerHeight - top) + 8}px`,
    );
  };
  useResizeObserver(form, updateToastOffset, { immediate: true });
  useEventListener(form ? "window" : null, "resize", updateToastOffset);
  useEventListener(
    form ? window.visualViewport : null,
    "resize",
    updateToastOffset,
  );

  // Re-run when focusOnMount flips true (e.g. progressive history ready).
  useFocusWhen(editorRef, focusOnMount, { deferToFrame: true });

  const handleActiveFormatsChange = useCallback(
    (formats: ComposerActiveFormats) => {
      setActiveFormats((previous) => {
        if (
          previous.bold === formats.bold &&
          previous.italic === formats.italic &&
          previous.underline === formats.underline &&
          previous.strikethrough === formats.strikethrough &&
          previous.code === formats.code &&
          previous.codeBlock === formats.codeBlock &&
          previous.quote === formats.quote &&
          previous.bulletList === formats.bulletList &&
          previous.numberedList === formats.numberedList &&
          previous.link === formats.link
        ) {
          return previous;
        }
        return formats;
      });
    },
    [],
  );

  const handleFilesSelected = useCallback(
    async (files: FileList | File[] | null): Promise<boolean> => {
      if (!allowAttachments) return false;

      const selectedFiles = Array.from(files ?? []).filter(
        (file) => file.size > 0,
      );
      if (selectedFiles.length === 0 || isUploadingFilesRef.current) {
        return false;
      }

      isUploadingFilesRef.current = true;
      setIsUploadingFiles(true);

      try {
        const uploaded = await uploadComposeAttachments(selectedFiles, {
          labels: {
            uploadingFile: getTaskAttachmentUploadLabelTemplate(
              tToolbar,
              "uploadingFile",
            ),
            uploadingFiles: getTaskAttachmentUploadLabelTemplate(
              tToolbar,
              "uploadingFiles",
            ),
            uploadError: tToolbar("uploadFailed"),
          },
          fallbackFileName: tToolbar("attachmentFallback"),
          roomId,
        });
        const uploadedAttachments: RoomComposerAttachment[] = uploaded.map(
          (result) => ({
            url: result.publicUrl,
            fileName: result.fileName,
            mediaType: result.mediaType,
          }),
        );

        // Chip-only. Markdown links are stitched into content on send.
        onAttachmentsChange((current) => [...current, ...uploadedAttachments]);
        toast.success(
          tToolbar("uploaded", { count: uploadedAttachments.length }),
        );
        return uploadedAttachments.length > 0;
      } catch {
        // Error toast is handled by uploadComposeAttachments.
        return false;
      } finally {
        isUploadingFilesRef.current = false;
        setIsUploadingFiles(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [allowAttachments, onAttachmentsChange, roomId, tToolbar],
  );

  async function dictate(file: File) {
    setIsTranscribing(true);
    try {
      const text = await transcribeVoiceRecording(file);
      if (!text) {
        toast(tToolbar("dictationEmpty"));
        return;
      }
      const joiner = value.length === 0 || /\s$/.test(value) ? "" : " ";
      editorRef.current?.insertText(`${joiner}${text}`);
      editorRef.current?.focus();
    } catch {
      toast.error(tToolbar("dictationFailed"));
    } finally {
      setIsTranscribing(false);
    }
  }

  async function handleAttachOverflowAsMarkdown() {
    if (!allowAttachments || !contentOverLimit) {
      return;
    }
    const uploaded = await handleFilesSelected([
      createRoomComposerOverflowMarkdownFile(value),
    ]);
    if (uploaded) {
      onValueChange("");
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      attachFiles: (files) => {
        void handleFilesSelected(files);
      },
      focus: () => {
        editorRef.current?.focus();
      },
      focusAtEnd: () => {
        editorRef.current?.focusAtEnd();
      },
      insertText: (text) => {
        editorRef.current?.insertText(text);
      },
      addText: (text) => {
        editorRef.current?.appendText(text);
      },
      removeLastText: (text) =>
        editorRef.current?.removeLastText(text) ?? false,
    }),
    [handleFilesSelected],
  );

  function removeAttachment(attachment: RoomComposerAttachment) {
    onAttachmentsChange((current) =>
      current.filter((item) => item.url !== attachment.url),
    );
    editorRef.current?.focus();
  }

  function openLinkDialog() {
    setFormatToolbarOpen(true);
    const selected = editorRef.current?.getSelectedPlainText() ?? "";
    setLinkInitialText(selected);
    setLinkInitialUrl(
      /^https?:\/\//i.test(selected.trim()) ? selected.trim() : "",
    );
    setLinkDialogOpen(true);
  }

  function handleFormat(command: ComposerFormatCommand) {
    setFormatToolbarOpen(true);
    editorRef.current?.applyFormat(command);
  }

  function handleLinkSave(text: string, url: string) {
    // Third path that puts text in the editor without anyone typing it, after
    // the emoji picker and quote-restore (ADR-0033).
    onToolbarInsert?.();
    editorRef.current?.insertLink(text, url);
    editorRef.current?.focus();
  }

  function handleDriveFileSelect(file: DriveFile) {
    const driveAttachment: RoomComposerAttachment = {
      url: file.fileUrl,
      fileName: file.name,
      mediaType: null,
    };
    onAttachmentsChange((current) => {
      if (current.some((a) => a.url === file.fileUrl)) {
        return current;
      }
      return [...current, driveAttachment];
    });
    editorRef.current?.focus();
  }

  return (
    <>
      <RoomMessageComposer
        typingLine={typingLine}
        aboveCard={aboveCard}
        formRef={attachForm}
        onSubmit={onSubmit}
        withOuterPadding={false}
        withSafeAreaPadding
        className="px-3 md:px-5"
        attachments={attachments}
        onRemoveAttachment={(attachment) =>
          removeAttachment({
            url: attachment.url,
            fileName: attachment.fileName,
            mediaType: attachment.mediaType ?? null,
          })
        }
        removeAttachmentLabel={(name) =>
          t("Toolbar.removeAttachment", { name })
        }
        isSending={isSending}
        sendDisabled={
          isUploadingFiles ||
          isRecordingVoice ||
          isTranscribing ||
          sendDisabled ||
          contentOverLimit
        }
        toolbarEnd={
          <>
            {showContentCount ? (
              <span
                className={cn(
                  "text-xs tabular-nums",
                  contentOverLimit
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
                aria-live="polite"
              >
                {t("composerCharacterCount", {
                  count: composedContent.length,
                  max: CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
                })}
              </span>
            ) : null}
            <DictationButton
              buttonClassName={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
              disabled={isTranscribing}
              loading={isTranscribing}
              onRecordingChange={setIsRecordingVoice}
              onRecorded={(file) => {
                void dictate(file);
              }}
            />
          </>
        }
        belowEditor={
          contentOverLimit ? (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 pb-1">
              <p className="text-destructive text-xs" role="alert">
                {t("composerTooLongHint")}
              </p>
              {allowAttachments ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  loading={isUploadingFiles}
                  onClick={() => {
                    void handleAttachOverflowAsMarkdown();
                  }}
                >
                  <FileText className="size-3.5" aria-hidden />
                  {t("composerConvertToFile")}
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
        sendAriaLabel={t("send")}
        onPrepareSubmit={() => editorRef.current?.flushTrailingEmoticon()}
        aboveEditor={
          <>
            {onSkillsChange ? (
              <ComposerSkillChips
                skills={skills}
                onRemove={(skill) => {
                  onSkillsChange(skills.filter((item) => item.id !== skill.id));
                  editorRef.current?.focus();
                }}
              />
            ) : null}
            {pendingQuote && onClearPendingQuote ? (
              <PendingQuotePreview
                quote={pendingQuote}
                onDismiss={onClearPendingQuote}
                mentions={mentions}
                usersById={usersById}
                usersBySlug={usersBySlug}
                coworkersById={coworkersById}
                coworkersBySlug={coworkersBySlug}
                sokoBotsById={sokoBotsById}
                sokoBotsBySlug={sokoBotsBySlug}
                channelLinks={channelLinks}
                currentUserId={currentUserId}
                canOpenHumanDirect={canOpenHumanDirect}
                onOpenDirectMessage={onOpenDirectMessage}
                openingDirectParticipantKey={openingDirectParticipantKey}
              />
            ) : null}
            {formatToolbarOpen ? (
              <ComposerFormatToolbar
                onFormat={handleFormat}
                onLink={openLinkDialog}
                activeFormats={activeFormats}
              />
            ) : null}
          </>
        }
        toolbarStart={
          <>
            {allowAttachments ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  tabIndex={-1}
                  onChange={(event) => {
                    void handleFilesSelected(event.currentTarget.files);
                  }}
                />
                <AttachmentSubmenu
                  onUploadClick={() => fileInputRef.current?.click()}
                  onDriveClick={() => setDrivePickerOpen(true)}
                  disabled={isUploadingFiles}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
                    title={t("Toolbar.attach")}
                    aria-label={t("Toolbar.attach")}
                    loading={isUploadingFiles}
                  >
                    <Paperclip className="size-4" aria-hidden />
                  </Button>
                </AttachmentSubmenu>
              </>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME,
                formatToolbarOpen && "bg-muted text-foreground",
              )}
              title={
                formatToolbarOpen
                  ? t("Toolbar.hideFormatting")
                  : t("Toolbar.showFormatting")
              }
              aria-label={
                formatToolbarOpen
                  ? t("Toolbar.hideFormatting")
                  : t("Toolbar.showFormatting")
              }
              aria-pressed={formatToolbarOpen}
              onClick={() => {
                const next = !formatToolbarOpen;
                setFormatToolbarOpen(next);
                if (next) {
                  handleActiveFormatsChange(
                    editorRef.current?.getActiveFormats() ??
                      EMPTY_COMPOSER_ACTIVE_FORMATS,
                  );
                } else {
                  setActiveFormats(EMPTY_COMPOSER_ACTIVE_FORMATS);
                }
              }}
            >
              <ALargeSmall className="size-4" aria-hidden />
            </Button>
            <RoomComposerEmojiPicker
              title={t("Toolbar.emoji")}
              ariaLabel={t("Toolbar.emoji")}
              onPick={(emoji) => {
                onToolbarInsert?.();
                editorRef.current?.insertText(emoji);
              }}
            />
            {allowAttachments && currentUserId ? (
              <StickerPicker
                userId={currentUserId}
                triggerClassName={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
                disabled={isSending}
                onPick={(sticker) => {
                  onAttachmentsChange((current) => [
                    ...current,
                    {
                      url: sticker.url,
                      fileName: sticker.name,
                      mediaType: null,
                    },
                  ]);
                  editorRef.current?.focus();
                }}
              />
            ) : null}
            {onSkillsChange ? (
              <SkillPicker
                selected={skills}
                triggerClassName={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
                onPick={(skill) => {
                  if (skills.some((item) => item.id === skill.id)) return;
                  onSkillsChange([...skills, skill]);
                  editorRef.current?.focus();
                }}
              />
            ) : null}
            {showMentionShortcut ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
                title={t("Toolbar.mention")}
                aria-label={t("Toolbar.mention")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => editorRef.current?.openMentions()}
              >
                <AtSign className="size-4" aria-hidden />
              </Button>
            ) : null}
          </>
        }
      >
        <ComposerWysiwygEditor
          ref={editorRef}
          value={value}
          onChange={onValueChange}
          onBlur={onEditorBlur}
          mentions={composerMentions}
          mentionDisplayByKey={mentionDisplay.byKey}
          mentionDisplayBySlug={mentionDisplay.bySlug}
          channels={channels}
          placeholder={placeholder}
          onSubmitShortcut={() => {
            // Enter while the mic is open would send without the recording.
            if (!isRecordingVoice && !isTranscribing)
              formRef.current?.requestSubmit();
          }}
          onLinkShortcut={openLinkDialog}
          onActiveFormatsChange={
            formatToolbarOpen ? handleActiveFormatsChange : undefined
          }
          className={ROOM_COMPOSER_TEXTAREA_CLASSNAME}
          groupMentions={(filtered) =>
            partitionRoomMentionSuggestions(filtered, {
              peopleLabel: t("MentionSections.people"),
              coworkersLabel: t("MentionSections.coworkers"),
              personalAssistantsLabel: t("MentionSections.personalAssistants"),
            })
          }
          renderMentionItem={(mention) => (
            <RoomMentionSuggestion mention={mention} />
          )}
        />
      </RoomMessageComposer>
      <ComposerAddLinkDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        initialText={linkInitialText}
        initialUrl={linkInitialUrl}
        onSave={handleLinkSave}
      />
      <DriveFilePicker
        open={drivePickerOpen}
        onOpenChange={setDrivePickerOpen}
        onSelect={handleDriveFileSelect}
      />
    </>
  );
}
