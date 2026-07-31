"use client";

import { AtSign, Loader2, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { getTaskAttachmentUploadLabelTemplate } from "@/app/tasks/components/task-attachment-upload-labels";
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
  MentionTextarea,
  type MentionTextareaHandle,
  type NormalizedMention,
} from "@/components/ui/mention-textarea";
import type { ChatRoomCoworkerParticipant } from "@/lib/clients/generated/core";
import { uploadComposeAttachments } from "@/lib/utils/compose-upload.client";
import {
  formatTaskAttachmentMarkdown,
  removeTaskAttachmentLinks,
} from "@/lib/utils/task-attachments";
import { getInitials } from "@/lib/utils/text";
import { AiCoworkerIcon } from "./room-draft-shared";
import { appendComposerBlock } from "./room-helpers";

export interface RoomComposerAttachment extends RoomMessageComposerAttachment {
  mediaType: string | null;
}

function CoworkerSuggestion({
  mention,
}: {
  mention: NormalizedMention<ChatRoomCoworkerParticipant>;
}) {
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
          <AiCoworkerIcon />
        </div>
        <div className="text-muted-foreground truncate text-xs">
          @{mention.slug}
        </div>
      </div>
    </>
  );
}

export function RoomComposer({
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
}: {
  /** When set, attaches mint via room chat file endpoint. */
  roomId?: string;
  value: string;
  onValueChange: Dispatch<SetStateAction<string>>;
  mentions: Record<string, MentionRecordEntry<ChatRoomCoworkerParticipant>>;
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
}) {
  const t = useTranslations("App.Channels");
  const tToolbar = useTranslations("App.Channels.Toolbar");
  const formRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<MentionTextareaHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const composerMentions = showMentionShortcut ? mentions : {};
  const handleSelectedKeysChange = showMentionShortcut
    ? onSelectedKeysChange
    : undefined;

  const handleFilesSelected = useCallback(
    async (files: FileList | null) => {
      const selectedFiles = Array.from(files ?? []).filter(
        (file) => file.size > 0,
      );
      if (selectedFiles.length === 0) {
        return;
      }

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

        const attachmentMarkdown = uploadedAttachments
          .map((attachment) =>
            formatTaskAttachmentMarkdown(attachment.fileName, attachment.url),
          )
          .join("");
        onAttachmentsChange((current) => [...current, ...uploadedAttachments]);
        onValueChange((current) =>
          appendComposerBlock(current, attachmentMarkdown),
        );
        toast.success(
          tToolbar("uploaded", { count: uploadedAttachments.length }),
        );
      } catch {
        // Error toast is handled by uploadComposeAttachments.
      } finally {
        setIsUploadingFiles(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [onAttachmentsChange, onValueChange, roomId, tToolbar],
  );

  function removeAttachment(attachment: RoomComposerAttachment) {
    onAttachmentsChange((current) =>
      current.filter((item) => item.url !== attachment.url),
    );
    onValueChange((current) =>
      removeTaskAttachmentLinks(current, [attachment.url]),
    );
    textareaRef.current?.focus();
  }

  return (
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
      removeAttachmentLabel={(name) => t("Toolbar.removeAttachment", { name })}
      isSending={isSending}
      sendDisabled={isUploadingFiles || sendDisabled}
      sendAriaLabel={t("send")}
      toolbarStart={
        <>
          {showMentionShortcut ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
              title={t("Toolbar.mention")}
              aria-label={t("Toolbar.mention")}
              onClick={() => textareaRef.current?.openMentions()}
            >
              <AtSign className="size-4" aria-hidden />
            </Button>
          ) : null}
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
          <RoomComposerEmojiPicker
            title={t("Toolbar.emoji")}
            ariaLabel={t("Toolbar.emoji")}
            onPick={(emoji) => textareaRef.current?.insertText(emoji)}
          />
        </>
      }
    >
      <MentionTextarea
        ref={textareaRef}
        value={value}
        onChange={onValueChange}
        onSelectedKeysChange={handleSelectedKeysChange}
        mentions={composerMentions}
        placeholder={placeholder}
        suggestionsAnchor="editor"
        submitOnEnter
        // On a phone Enter is the only newline key, and the send button is
        // always visible — so Enter composes rather than sends.
        allowEnterToSubmitOnMobile={false}
        onSubmitShortcut={() => formRef.current?.requestSubmit()}
        // Capped so a long draft scrolls inside the composer instead of
        // growing it until the toolbar and send button leave the screen.
        className={ROOM_COMPOSER_TEXTAREA_CLASSNAME}
        renderItem={(mention) => <CoworkerSuggestion mention={mention} />}
      />
    </RoomMessageComposer>
  );
}
