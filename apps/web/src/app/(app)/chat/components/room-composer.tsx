"use client";

import { AtSign, Loader2, Paperclip, Type } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type Dispatch,
  type FormEvent,
  type Ref,
  type SetStateAction,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  type MentionRecordEntry,
  type NormalizedMention,
} from "@/components/ui/mention-textarea";
import { cn } from "@/lib/utils";
import { uploadComposeAttachments } from "@/lib/utils/compose-upload.client";
import type { ComposerFormatCommand } from "@/lib/utils/composer-markdown-wrap";
import { normalizeUrl } from "@/lib/utils/markdown-editor-utils";
import { getInitials } from "@/lib/utils/text";
import { AiCoworkerIcon } from "./room-draft-shared";
import type { RoomMentionParticipant } from "./room-helpers";

export interface RoomComposerAttachment extends RoomMessageComposerAttachment {
  mediaType: string | null;
}

/** Shell drop zones call this to reuse the paperclip upload path. */
export interface RoomComposerHandle {
  attachFiles: (files: FileList | File[] | null) => void;
}

function RoomMentionSuggestion({
  mention,
}: {
  mention: NormalizedMention<RoomMentionParticipant>;
}) {
  const isCoworker = mention.data?.kind === "coworker";
  return (
    <>
      <Avatar className="size-6">
        <AvatarImage src={mention.data?.image ?? undefined} alt="" />
        <AvatarFallback className="text-[10px]">
          {getInitials(mention.value)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{mention.value}</span>
          {isCoworker ? <AiCoworkerIcon /> : null}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          @{mention.slug}
        </div>
      </div>
    </>
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
  onChromeResize,
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
  /**
   * Fired when composer chrome height changes (e.g. format strip toggles)
   * so the parent can keep the latest message visible above the composer.
   */
  onChromeResize?: () => void;
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
  /** Slack Aa: formatting strip above the editor. */
  const [formatToolbarOpen, setFormatToolbarOpen] = useState(false);
  const onChromeResizeRef = useRef(onChromeResize);
  onChromeResizeRef.current = onChromeResize;
  const composerMentions = showMentionShortcut ? mentions : {};
  const handleSelectedKeysChange = showMentionShortcut
    ? onSelectedKeysChange
    : undefined;

  // After paint so the format strip has height before the parent scrolls.
  useEffect(() => {
    const notify = onChromeResizeRef.current;
    if (!notify) return;
    const frame = requestAnimationFrame(() => {
      notify();
    });
    return () => cancelAnimationFrame(frame);
  }, [formatToolbarOpen]);

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
    if (!normalizeUrl(url)) return;
    editorRef.current?.insertLink(text, url);
    editorRef.current?.focus();
  }

  return (
    <>
      <RoomMessageComposer
        formRef={formRef}
        onSubmit={onSubmit}
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
        aboveEditor={
          formatToolbarOpen ? (
            <ComposerFormatToolbar
              onFormat={handleFormat}
              onLink={openLinkDialog}
            />
          ) : null
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
              onClick={() => setFormatToolbarOpen((open) => !open)}
            >
              <Type className="size-4" aria-hidden />
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
          className={ROOM_COMPOSER_TEXTAREA_CLASSNAME}
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
