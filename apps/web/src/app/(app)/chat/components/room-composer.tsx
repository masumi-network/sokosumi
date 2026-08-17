"use client";

import {
  ALargeSmall,
  AtSign,
  Loader2,
  Paperclip,
  Users,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type Dispatch,
  type FormEvent,
  type Ref,
  type SetStateAction,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  getFormatToolbarOpenPreference,
  resolveFormatToolbarOpenOnMount,
  setFormatToolbarOpenPreference,
} from "@/app/chat/utils/format-toolbar-preference-storage";
import { getTaskAttachmentUploadLabelTemplate } from "@/app/tasks/components/task-attachment-upload-labels";
import { ComposerAddLinkDialog } from "@/components/chat/composer-add-link-dialog";
import { ComposerFormatToolbar } from "@/components/chat/composer-format-toolbar";
import {
  ComposerWysiwygEditor,
  type ComposerWysiwygEditorHandle,
} from "@/components/chat/composer-wysiwyg-editor";
import {
  ROOM_COMPOSER_TEXTAREA_CLASSNAME,
  ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME,
  RoomComposerEmojiPicker,
  RoomMessageComposer,
  type RoomMessageComposerAttachment,
} from "@/components/chat/room-message-composer";
import Markdown from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FileChipMiniPreview } from "@/components/ui/file-chip-mini-preview";
import {
  type MentionRecordEntry,
  type NormalizedMention,
} from "@/components/ui/mention-textarea";
import { MOBILE_BREAKPOINT } from "@/hooks/use-mobile";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { uploadComposeAttachments } from "@/lib/utils/compose-upload.client";
import {
  type ComposerActiveFormats,
  type ComposerFormatCommand,
  EMPTY_COMPOSER_ACTIVE_FORMATS,
} from "@/lib/utils/composer-active-formats";
import { getInitials } from "@/lib/utils/text";
import { AiCoworkerIcon } from "./room-draft-shared";
import {
  formatRoomMarkdownMentions,
  type PendingRoomQuote,
  partitionRoomMentionSuggestions,
  ROOM_QUOTE_MARKDOWN_CLASSNAME,
  type RoomMentionParticipant,
} from "./room-helpers";

export interface RoomComposerAttachment extends RoomMessageComposerAttachment {
  mediaType: string | null;
}

/** Shell drop zones + Quote/Thread callers reuse this surface. */
export interface RoomComposerHandle {
  attachFiles: (files: FileList | File[] | null) => void;
  focus: () => void;
  /** Empty compose text without resigning first responder (SOK-815 / iOS OSK). */
  clearKeepingFocus: () => void;
}

function RoomMentionSuggestion({
  mention,
}: {
  mention: NormalizedMention<RoomMentionParticipant>;
}) {
  const t = useTranslations("App.Channels");
  const isCoworker = mention.data?.kind === "coworker";
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
          <AvatarFallback className="text-[0.625rem]">
            {getInitials(mention.value)}
          </AvatarFallback>
        </Avatar>
      )}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{displayName}</span>
          {isCoworker ? <AiCoworkerIcon /> : null}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          @{mention.slug}
        </div>
      </div>
    </>
  );
}

type UserMentionLookup = Pick<ChatRoomUserParticipant, "id" | "name">;

function mentionLookupMapsFromCatalog(
  mentions: Record<string, MentionRecordEntry<RoomMentionParticipant>>,
): {
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  usersById: Map<string, UserMentionLookup>;
  usersBySlug: Map<string, UserMentionLookup>;
} {
  const coworkersById = new Map<string, ChatRoomCoworkerParticipant>();
  const coworkersBySlug = new Map<string, ChatRoomCoworkerParticipant>();
  const usersById = new Map<string, UserMentionLookup>();
  const usersBySlug = new Map<string, UserMentionLookup>();

  for (const entry of Object.values(mentions)) {
    const data = entry.data;
    if (!data) {
      continue;
    }
    if (data.kind === "coworker") {
      const coworker: ChatRoomCoworkerParticipant = {
        id: data.id,
        name: data.name,
        slug: data.slug,
        caption: null,
        image: data.image,
        presence: "offline",
      };
      coworkersById.set(data.id, coworker);
      coworkersBySlug.set(data.slug, coworker);
      continue;
    }
    if (data.kind === "human") {
      const user: UserMentionLookup = { id: data.id, name: data.name };
      usersById.set(data.id, user);
      usersBySlug.set(data.slug, user);
    }
  }

  return { coworkersById, coworkersBySlug, usersById, usersBySlug };
}

function PendingQuotePreview({
  quote,
  onDismiss,
  mentions,
}: {
  quote: PendingRoomQuote;
  onDismiss: () => void;
  mentions: Record<string, MentionRecordEntry<RoomMentionParticipant>>;
}) {
  const t = useTranslations("App.Channels.Quote");
  const { coworkersById, coworkersBySlug, usersById, usersBySlug } =
    mentionLookupMapsFromCatalog(mentions);

  const attachment = quote.attachment;

  return (
    <div
      className="border-border bg-muted/30 flex items-start gap-2 border-b px-3 py-2"
      role="status"
      aria-label={t("previewLabel", { author: quote.authorName })}
    >
      <div className="border-primary/60 min-w-0 flex-1 border-l-2 pl-2.5">
        <div className="text-foreground truncate text-xs font-semibold">
          {quote.authorName}
        </div>
        <div className="flex items-start gap-2">
          {attachment ? (
            <FileChipMiniPreview
              url={attachment.url}
              fileName={attachment.fileName}
              sizeClass="size-10"
              className="shrink-0"
            />
          ) : null}
          {quote.snippet.trim() ? (
            <div className="text-muted-foreground line-clamp-4 min-w-0 flex-1 text-xs leading-5">
              <Markdown className={ROOM_QUOTE_MARKDOWN_CLASSNAME}>
                {formatRoomMarkdownMentions({
                  content: quote.snippet,
                  coworkersById,
                  coworkersBySlug,
                  usersById,
                  usersBySlug,
                })}
              </Markdown>
            </div>
          ) : null}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 rounded-full"
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
  mentions,
  onSelectedKeysChange,
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
  onChromeResize,
  focusOnMount = false,
}: {
  ref?: Ref<RoomComposerHandle>;
  /** When set, attaches mint via room chat file endpoint. */
  roomId?: string;
  value: string;
  onValueChange: Dispatch<SetStateAction<string>>;
  mentions: Record<string, MentionRecordEntry<RoomMentionParticipant>>;
  onSelectedKeysChange: (selectedKeys: string[]) => void;
  placeholder: string;
  attachments: RoomComposerAttachment[];
  onAttachmentsChange: Dispatch<SetStateAction<RoomComposerAttachment[]>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSending: boolean;
  sendDisabled: boolean;
  /** Channels always; direct rooms only when roster has more than two people. */
  showMentionShortcut?: boolean;
  /** False when the send path cannot persist uploads (e.g. coworker stream). */
  allowAttachments?: boolean;
  /** Slack-like dismissible quote chip above the editor. */
  pendingQuote?: PendingRoomQuote | null;
  onClearPendingQuote?: () => void;
  /**
   * Fired when composer chrome height changes (e.g. format strip toggles)
   * so the parent can keep the latest message visible above the composer.
   */
  onChromeResize?: () => void;
  /** Focus the editor after mount (room/thread open). */
  focusOnMount?: boolean;
}) {
  const t = useTranslations("App.Channels");
  const tToolbar = useTranslations("App.Channels.Toolbar");
  const formRef = useRef<HTMLFormElement | null>(null);
  const editorRef = useRef<ComposerWysiwygEditorHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isUploadingFilesRef = useRef(false);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkInitialText, setLinkInitialText] = useState("");
  const [linkInitialUrl, setLinkInitialUrl] = useState("");
  /**
   * Slack Aa toggle: formatting strip above the editor.
   * SSR + first paint start closed (hydration-safe). Preference persisted via localStorage on Aa.
   */
  const [formatToolbarOpen, setFormatToolbarOpen] = useState(false);
  const [activeFormats, setActiveFormats] = useState<ComposerActiveFormats>(
    EMPTY_COMPOSER_ACTIVE_FORMATS,
  );
  const onChromeResizeRef = useRef(onChromeResize);
  onChromeResizeRef.current = onChromeResize;
  const composerMentions = showMentionShortcut ? mentions : {};
  const handleSelectedKeysChange = showMentionShortcut
    ? onSelectedKeysChange
    : undefined;

  // Stored pref wins; else desktop open / mobile closed (SOK-681).
  // useLayoutEffect: apply before paint so Instant → real composer does not
  // grow a second time when the format strip opens after first paint.
  useLayoutEffect(() => {
    setFormatToolbarOpen(
      resolveFormatToolbarOpenOnMount({
        stored: getFormatToolbarOpenPreference(),
        viewportWidth: window.innerWidth,
        mobileBreakpoint: MOBILE_BREAKPOINT,
      }),
    );
  }, []);

  // Re-run when focusOnMount flips true (e.g. progressive history ready).
  useEffect(() => {
    if (!focusOnMount) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusOnMount]);

  // After paint so the format strip / quote chip have height before scroll.
  useEffect(() => {
    const notify = onChromeResizeRef.current;
    if (!notify) return;
    const frame = requestAnimationFrame(() => {
      notify();
    });
    return () => cancelAnimationFrame(frame);
  }, [formatToolbarOpen, pendingQuote?.messageId]);

  useEffect(() => {
    if (!formatToolbarOpen) {
      setActiveFormats(EMPTY_COMPOSER_ACTIVE_FORMATS);
    }
  }, [formatToolbarOpen]);

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
    async (files: FileList | File[] | null) => {
      if (!allowAttachments) return;

      const selectedFiles = Array.from(files ?? []).filter(
        (file) => file.size > 0,
      );
      if (selectedFiles.length === 0 || isUploadingFilesRef.current) {
        return;
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
      } catch {
        // Error toast is handled by uploadComposeAttachments.
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

  useImperativeHandle(
    ref,
    () => ({
      attachFiles: (files) => {
        void handleFilesSelected(files);
      },
      focus: () => {
        editorRef.current?.focus();
      },
      clearKeepingFocus: () => {
        editorRef.current?.clearKeepingFocus();
      },
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
    editorRef.current?.insertLink(text, url);
    editorRef.current?.focus();
  }

  return (
    <>
      <RoomMessageComposer
        formRef={formRef}
        onSubmit={onSubmit}
        withOuterPadding={false}
        withSafeAreaPadding
        className="px-3 pt-2 md:px-5 md:pt-3"
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
        sendDisabled={isUploadingFiles || sendDisabled}
        sendAriaLabel={t("send")}
        onPrepareSubmit={() => editorRef.current?.flushTrailingEmoticon()}
        aboveEditor={
          <>
            {pendingQuote && onClearPendingQuote ? (
              <PendingQuotePreview
                quote={pendingQuote}
                onDismiss={onClearPendingQuote}
                mentions={composerMentions}
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
                  title={t("Toolbar.attach")}
                  aria-label={t("Toolbar.attach")}
                  disabled={isUploadingFiles}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isUploadingFiles ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Paperclip className="size-4" aria-hidden />
                  )}
                </Button>
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
                setFormatToolbarOpen((open) => {
                  const next = !open;
                  setFormatToolbarOpenPreference(next);
                  return next;
                });
              }}
            >
              <ALargeSmall className="size-4" aria-hidden />
            </Button>
            <RoomComposerEmojiPicker
              title={t("Toolbar.emoji")}
              ariaLabel={t("Toolbar.emoji")}
              onPick={(emoji) => editorRef.current?.insertText(emoji)}
            />
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
          onSelectedKeysChange={handleSelectedKeysChange}
          mentions={composerMentions}
          placeholder={placeholder}
          onSubmitShortcut={() => formRef.current?.requestSubmit()}
          onLinkShortcut={openLinkDialog}
          onActiveFormatsChange={
            formatToolbarOpen ? handleActiveFormatsChange : undefined
          }
          className={ROOM_COMPOSER_TEXTAREA_CLASSNAME}
          groupMentions={(filtered) =>
            partitionRoomMentionSuggestions(filtered, {
              peopleLabel: t("MentionSections.people"),
              coworkersLabel: t("MentionSections.coworkers"),
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
    </>
  );
}
