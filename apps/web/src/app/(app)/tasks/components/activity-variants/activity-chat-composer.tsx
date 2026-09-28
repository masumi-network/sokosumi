"use client";

import { formatTaskAttachmentMarkdown } from "@sokosumi/utils";
import { ALargeSmall, AtSign, Loader2, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { buildRoomComposerMessageContent } from "@/app/chat/components/room-helpers";
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
import { AttachmentSubmenu } from "@/components/drive/attachment-submenu";
import { DriveFilePicker } from "@/components/drive/drive-file-picker";
import { Button } from "@/components/ui/button";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea-utils";
import type { DriveFile } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import {
  type ComposerActiveFormats,
  type ComposerFormatCommand,
  EMPTY_COMPOSER_ACTIVE_FORMATS,
} from "@/lib/utils/composer-active-formats";
import { sanitizeTaskAttachmentLabel } from "@/lib/utils/task-attachments";
import { uploadTaskAttachment } from "@/lib/utils/task-attachments.client";
import { getUserFileUploadErrorMessage } from "@/lib/utils/user-file-upload.client";

interface ActivityChatComposerProps {
  taskId: string;
  placeholder: string;
  sendLabel: string;
  mentions: Record<string, MentionRecordEntry>;
  sendDisabled: boolean;
  isSending: boolean;
  /** Receives the finished markdown, attachment links appended. */
  onSend: (markdown: string) => void;
}

/**
 * The chat room composer, fed by task comments: same card, same toolbar,
 * same editor. Attachments ride as chips and become markdown links on send.
 */
export function ActivityChatComposer({
  taskId,
  placeholder,
  sendLabel,
  mentions,
  sendDisabled,
  isSending,
  onSend,
}: ActivityChatComposerProps) {
  const tToolbar = useTranslations("App.Channels.Toolbar");
  const tDetail = useTranslations("App.Tasks.Detail");
  const formRef = useRef<HTMLFormElement | null>(null);
  const editorRef = useRef<ComposerWysiwygEditorHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<
    RoomMessageComposerAttachment[]
  >([]);
  const [isUploading, setIsUploading] = useState(false);
  const [formatToolbarOpen, setFormatToolbarOpen] = useState(false);
  const [activeFormats, setActiveFormats] = useState<ComposerActiveFormats>(
    EMPTY_COMPOSER_ACTIVE_FORMATS,
  );
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkInitialText, setLinkInitialText] = useState("");
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);

  const content = buildRoomComposerMessageContent(
    value,
    attachments,
    formatTaskAttachmentMarkdown,
  );
  const blocked = sendDisabled || isUploading || content.length === 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || isSending) {
      return;
    }
    onSend(content);
    setValue("");
    setAttachments([]);
  }

  async function handleFilesSelected(files: FileList | null) {
    const selected = Array.from(files ?? []).filter((file) => file.size > 0);
    if (selected.length === 0) {
      return;
    }
    setIsUploading(true);
    try {
      for (const file of selected) {
        const url = await uploadTaskAttachment(taskId, file);
        const fileName = sanitizeTaskAttachmentLabel(
          file.name,
          tDetail("fileLabel"),
        );
        setAttachments((current) => [
          ...current,
          { url, fileName, mediaType: file.type || null },
        ]);
      }
    } catch (error) {
      toast.error(
        getUserFileUploadErrorMessage(error, tDetail("uploadFileErrorRetry")),
      );
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleDriveFileSelect(file: DriveFile) {
    setAttachments((current) =>
      current.some((item) => item.url === file.fileUrl)
        ? current
        : [...current, { url: file.fileUrl, fileName: file.name }],
    );
    editorRef.current?.focus();
  }

  function handleFormat(command: ComposerFormatCommand) {
    editorRef.current?.applyFormat(command);
  }

  function openLinkDialog() {
    setLinkInitialText(editorRef.current?.getSelectedPlainText() ?? "");
    setLinkDialogOpen(true);
  }

  return (
    <>
      <RoomMessageComposer
        formRef={formRef}
        onSubmit={handleSubmit}
        withOuterPadding={false}
        withSafeAreaPadding={false}
        attachments={attachments}
        onRemoveAttachment={(attachment) =>
          setAttachments((current) =>
            current.filter((item) => item.url !== attachment.url),
          )
        }
        removeAttachmentLabel={(name) => tToolbar("removeAttachment", { name })}
        isSending={isSending}
        sendDisabled={blocked}
        sendAriaLabel={sendLabel}
        aboveEditor={
          formatToolbarOpen ? (
            <ComposerFormatToolbar
              onFormat={handleFormat}
              onLink={openLinkDialog}
              activeFormats={activeFormats}
            />
          ) : null
        }
        toolbarStart={
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
              disabled={isUploading}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
                title={tToolbar("attach")}
                aria-label={tToolbar("attach")}
                disabled={isUploading}
              >
                {isUploading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Paperclip className="size-4" aria-hidden />
                )}
              </Button>
            </AttachmentSubmenu>
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
                  ? tToolbar("hideFormatting")
                  : tToolbar("showFormatting")
              }
              aria-label={
                formatToolbarOpen
                  ? tToolbar("hideFormatting")
                  : tToolbar("showFormatting")
              }
              aria-pressed={formatToolbarOpen}
              onClick={() => {
                setFormatToolbarOpen((open) => !open);
                setActiveFormats(EMPTY_COMPOSER_ACTIVE_FORMATS);
              }}
            >
              <ALargeSmall className="size-4" aria-hidden />
            </Button>
            <RoomComposerEmojiPicker
              title={tToolbar("emoji")}
              ariaLabel={tToolbar("emoji")}
              onPick={(emoji) => editorRef.current?.insertText(emoji)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
              title={tToolbar("mention")}
              aria-label={tToolbar("mention")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editorRef.current?.openMentions()}
            >
              <AtSign className="size-4" aria-hidden />
            </Button>
          </>
        }
      >
        <ComposerWysiwygEditor
          ref={editorRef}
          value={value}
          onChange={setValue}
          mentions={mentions}
          placeholder={placeholder}
          ariaLabel={placeholder}
          onSubmitShortcut={() => formRef.current?.requestSubmit()}
          onLinkShortcut={openLinkDialog}
          onActiveFormatsChange={
            formatToolbarOpen ? setActiveFormats : undefined
          }
          className={ROOM_COMPOSER_TEXTAREA_CLASSNAME}
        />
      </RoomMessageComposer>
      <ComposerAddLinkDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        initialText={linkInitialText}
        onSave={(text, url) => {
          editorRef.current?.insertLink(text, url);
          editorRef.current?.focus();
        }}
      />
      <DriveFilePicker
        open={drivePickerOpen}
        onOpenChange={setDrivePickerOpen}
        onSelect={handleDriveFileSelect}
      />
    </>
  );
}
