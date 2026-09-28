"use client";

import { formatTaskAttachmentMarkdown } from "@sokosumi/utils";
import { ALargeSmall, AtSign, Loader2, Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
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
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea-utils";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { DriveFile } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import {
  type ComposerActiveFormats,
  type ComposerFormatCommand,
  EMPTY_COMPOSER_ACTIVE_FORMATS,
} from "@/lib/utils/composer-active-formats";
import { createFileUploadProgressToast } from "@/lib/utils/file-upload-progress-toast";
import { sanitizeTaskAttachmentLabel } from "@/lib/utils/task-attachments";
import { uploadTaskAttachment } from "@/lib/utils/task-attachments.client";
import { getUserFileUploadErrorMessage } from "@/lib/utils/user-file-upload.client";
import { getTaskAttachmentUploadLabelTemplate } from "./task-attachment-upload-labels";

interface TaskActivityComposerProps {
  taskId: string;
  placeholder: string;
  submitLabel: string;
  mentions: Record<string, MentionRecordEntry>;
  sendDisabled: boolean;
  isSending: boolean;
  /**
   * Receives the finished markdown, attachment links appended. Resolves
   * false when the send failed, and the draft comes back.
   */
  onSend: (markdown: string) => Promise<boolean>;
}

export function TaskActivityComposer({
  taskId,
  placeholder,
  submitLabel,
  mentions,
  sendDisabled,
  isSending,
  onSend,
}: TaskActivityComposerProps) {
  const t = useTranslations("App.Tasks.Detail");
  const tToolbar = useTranslations("App.Channels.Toolbar");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const editorRef = useRef<ComposerWysiwygEditorHandle | null>(null);
  const attachmentTriggerRef = useRef<HTMLButtonElement>(null);
  const activeUploadControllersRef = useRef(new Set<AbortController>());
  const isUnmountingRef = useRef(false);
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<
    RoomMessageComposerAttachment[]
  >([]);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [formatToolbarOpen, setFormatToolbarOpen] = useState(false);
  const [activeFormats, setActiveFormats] = useState<ComposerActiveFormats>(
    EMPTY_COMPOSER_ACTIVE_FORMATS,
  );
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkInitialText, setLinkInitialText] = useState("");
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);

  useMountEffect(() => {
    isUnmountingRef.current = false;
    const controllers = activeUploadControllersRef.current;
    return () => {
      isUnmountingRef.current = true;
      for (const controller of controllers) {
        controller.abort();
      }
      controllers.clear();
    };
  });

  const isUploading = uploadingCount > 0;
  const content = buildRoomComposerMessageContent(
    value,
    attachments,
    formatTaskAttachmentMarkdown,
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendDisabled || isSending || isUploading || content.length === 0) {
      return;
    }
    const draft = { value, attachments };
    setValue("");
    setAttachments([]);
    void onSend(content).then((sent) => {
      if (!sent) {
        setValue((current) => {
          if (current.length === 0) return draft.value;
          if (draft.value.length === 0) return current;
          return `${draft.value}\n${current}`;
        });
        setAttachments((current) =>
          current.length === 0
            ? draft.attachments
            : [...draft.attachments, ...current],
        );
      }
    });
  }

  async function handleAttachFiles(files: File[]) {
    if (files.length === 0) return;

    const uploadToast = createFileUploadProgressToast({
      files,
      labels: {
        uploadingFile: getTaskAttachmentUploadLabelTemplate(t, "uploadingFile"),
        uploadingFiles: getTaskAttachmentUploadLabelTemplate(
          t,
          "uploadingFiles",
        ),
      },
    });
    const controller = new AbortController();
    activeUploadControllersRef.current.add(controller);
    setUploadingCount((count) => count + 1);
    try {
      for (const [index, file] of files.entries()) {
        const url = await uploadTaskAttachment(taskId, file, {
          abortSignal: controller.signal,
          onUploadProgress: (progress) => {
            uploadToast.updateFileProgress(index, progress);
          },
        });
        uploadToast.markFileComplete(index);
        const fileName = sanitizeTaskAttachmentLabel(file.name, t("fileLabel"));
        setAttachments((current) => [
          ...current,
          { url, fileName, mediaType: file.type || null },
        ]);
      }
      uploadToast.dismiss();
      router.refresh();
    } catch (error) {
      uploadToast.dismiss();
      if (!(isUnmountingRef.current && controller.signal.aborted)) {
        toast.error(
          getUserFileUploadErrorMessage(error, t("uploadFileErrorRetry")),
        );
      }
    } finally {
      activeUploadControllersRef.current.delete(controller);
      setPendingUploadFiles([]);
      setUploadingCount((count) => count - 1);
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

  const formattingLabel = formatToolbarOpen
    ? tToolbar("hideFormatting")
    : tToolbar("showFormatting");

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
        sendDisabled={sendDisabled || isUploading || content.length === 0}
        sendAriaLabel={submitLabel}
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
            <AttachmentSubmenu
              onUploadClick={() => attachmentTriggerRef.current?.click()}
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
              title={formattingLabel}
              aria-label={formattingLabel}
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
        <FileUpload
          value={pendingUploadFiles}
          onValueChange={setPendingUploadFiles}
          onAccept={(files) => {
            void handleAttachFiles(files);
          }}
          multiple
        >
          <FileUploadDropzone
            noClick
            tabIndex={-1}
            className="data-dragging:bg-card-background w-full items-stretch justify-start gap-0 rounded-none border-0 p-0 select-auto hover:bg-transparent"
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
            <FileUploadTrigger asChild>
              <button
                ref={attachmentTriggerRef}
                type="button"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
              />
            </FileUploadTrigger>
          </FileUploadDropzone>
        </FileUpload>
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
