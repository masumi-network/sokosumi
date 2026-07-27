"use client";

import {
  findMarkdownLinks,
  isFileLikeUrl,
  unescapeMarkdownLinkUrl,
} from "@sokosumi/utils";
import {
  ArrowUp,
  AtSign,
  Bot,
  CheckCircle2,
  Hash,
  Loader2,
  MessageCircle,
  Paperclip,
  Search,
  Settings2,
  SmilePlus,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  listChannelMessagesAction,
  listThreadMessagesAction,
  sendChannelMessageAction,
  sendNewChannelMessageAction,
  sendNewDirectMessageAction,
  toggleMessageReactionAction,
  updateChannelAction,
} from "@/app/channels/actions";
import { mergeChannelMessages } from "@/app/channels/utils/merge-channel-messages";
import DaySeparator from "@/app/chat/components/day-separator";
import { slugify } from "@/app/chat/utils/bucket-slug";
import { formatDaySeparator } from "@/app/chat/utils/date-utils";
import { CHAT_APP_ROUTE_PREFIX } from "@/app/chat-ui/utils/chat-route-base";
import { writePendingCoworkerDirectMessage } from "@/app/chat-ui/utils/pending-coworker-direct-message";
import { markOrganizationChatChannelReadAction } from "@/components/chat/organization-chat-list.actions";
import { PresenceDot } from "@/components/chat/presence-dot";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import Markdown from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type MentionRecordEntry,
  MentionTextarea,
  type MentionTextareaHandle,
  type NormalizedMention,
} from "@/components/ui/mention-textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useRegisterBreadcrumbOverride } from "@/contexts/breadcrumb-override-context";
import type {
  ChatRoom,
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  ChatRoomPresence,
  Coworker,
  Member,
  Organization,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { parseMentions } from "@/lib/utils/mention-parser";
import {
  formatTaskAttachmentMarkdown,
  removeTaskAttachmentLinks,
  sanitizeTaskAttachmentLabel,
} from "@/lib/utils/task-attachments";
import { getInitials } from "@/lib/utils/text";
import {
  getUserFileUploadErrorMessage,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";

interface ChannelsClientProps {
  activeOrganization: Organization;
  channels: ChatRoom[];
  organizationMembers: Member[];
  currentUserId: string;
  coworkers: Coworker[];
  selectedChannelId: string | null;
  isCreateChannelRequested: boolean;
  isNewDirectMessage: boolean;
  messageLoadFailed: boolean;
  messages: ChatRoomMessage[];
  /** Cursor for the next older page; null when the initial page is complete. */
  messagesNextCursor: string | null;
}

const CHANNEL_COMPOSER_EMOJIS = [
  "👍",
  "❤️",
  "😂",
  "🎉",
  "🙏",
  "🔥",
  "✅",
  "👀",
  "💯",
  "🚀",
  "🙂",
  "😅",
];
const COWORKER_RESPONSE_POLL_MS = 2500;
/** ~2.5 minutes of polling before we stop waiting for a coworker reply. */
const COWORKER_RESPONSE_POLL_MAX_ATTEMPTS = 60;
/** Match sidebar channel-list cadence for peer traffic while a channel is open. */
const CHANNEL_LIVE_POLL_MS = 15_000;

interface ChannelComposerAttachment {
  url: string;
  fileName: string;
  mediaType: string | null;
}

function appendComposerBlock(value: string, block: string): string {
  if (!value.trim()) {
    return block;
  }

  const trimmedRight = value.trimEnd();
  return `${trimmedRight}\n${block}`;
}

function AiCoworkerIcon({ className }: { className?: string }) {
  const t = useTranslations("App.Channels");

  return (
    <Bot
      className={cn("text-muted-foreground size-3.5 shrink-0", className)}
      aria-label={t("coworkerBadge")}
    />
  );
}

function hasPendingCoworkerMention(messages: ChatRoomMessage[]): boolean {
  return messages.some((message) =>
    message.mentions.some(
      (mention) => mention.status === "pending" || mention.status === "sent",
    ),
  );
}

function appendMessage(
  messages: ChatRoomMessage[],
  nextMessage: ChatRoomMessage,
): ChatRoomMessage[] {
  if (messages.some((message) => message.id === nextMessage.id)) {
    return messages;
  }
  return [...messages, nextMessage];
}

function toggleId(ids: string[], id: string, checked: boolean): string[] {
  if (checked) {
    return ids.includes(id) ? ids : [...ids, id];
  }
  return ids.filter((item) => item !== id);
}

function messageSender(message: ChatRoomMessage) {
  if (message.sender.type === "user") {
    return {
      name: message.sender.user.name,
      image: message.sender.user.image,
      kind: "human" as const,
    };
  }
  if (message.sender.type === "coworker") {
    return {
      name: message.sender.coworker.name,
      image: message.sender.coworker.image,
      kind: "coworker" as const,
    };
  }
  return {
    name: "Unknown",
    image: null,
    kind: "unknown" as const,
  };
}

function formatMessageTime(value: Date | string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function messageDayKey(value: Date | string): string {
  return new Date(value).toDateString();
}

/**
 * Day separators are derived from the local date, so a message written near
 * midnight can land in a different bucket on the server than in the browser.
 * The separator text itself is marked as client-resolved for the same reason
 * the timestamps are.
 */

function getDirectChannelTarget(channel: ChatRoom, currentUserId: string) {
  return (
    channel.userMembers.find((member) => member.id !== currentUserId) ??
    channel.userMembers[0] ??
    null
  );
}

interface DirectParticipantPreview {
  id: string;
  name: string;
  detail: string | null;
  image: string | null;
  presence: ChatRoomPresence;
  kind: "human" | "coworker";
}

function getDirectChannelParticipants(
  channel: ChatRoom,
  currentUserId: string,
): DirectParticipantPreview[] {
  return [
    ...channel.userMembers
      .filter((member) => member.id !== currentUserId)
      .map((member) => ({
        id: member.id,
        name: member.name || member.email,
        detail: member.email,
        image: member.image,
        presence: member.presence,
        kind: "human" as const,
      })),
    ...channel.coworkerMembers.map((coworker) => ({
      id: coworker.id,
      name: coworker.name,
      detail: coworker.caption,
      image: coworker.image,
      presence: coworker.presence,
      kind: "coworker" as const,
    })),
  ];
}

/** Direct rooms: @ only when the roster has more than two people (incl. you). */
function shouldShowRoomMentionShortcut(channel: ChatRoom): boolean {
  if (channel.kind !== "direct") {
    return true;
  }
  return channel.userMembers.length + channel.coworkerMembers.length > 2;
}

function formatDirectParticipantNames(
  participants: DirectParticipantPreview[],
  fallback: string,
): string {
  if (participants.length === 0) {
    return fallback;
  }

  const names = participants.map((participant) => participant.name);
  if (names.length <= 3) {
    return names.join(", ");
  }

  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

function getChannelDisplayName(
  channel: ChatRoom,
  currentUserId: string,
): string {
  if (channel.kind !== "direct") {
    return channel.name;
  }
  return formatDirectParticipantNames(
    getDirectChannelParticipants(channel, currentUserId),
    getDirectChannelTarget(channel, currentUserId)?.name || channel.name,
  );
}

function getDirectChannelSubtitle(
  channel: ChatRoom,
  currentUserId: string,
  options: {
    fallback: string;
    participantCountLabel: (count: number) => string;
  },
): string {
  const participants = getDirectChannelParticipants(channel, currentUserId);

  if (participants.length === 1) {
    const participant = participants[0];
    if (participant.kind === "coworker") {
      return participant.detail ?? options.fallback;
    }
    return participant.detail ?? options.fallback;
  }

  if (participants.length > 1) {
    return options.participantCountLabel(participants.length);
  }

  return options.fallback;
}

interface ChannelParticipantPreview {
  id: string;
  name: string;
  image: string | null;
  presence: ChatRoomPresence;
  kind: "human" | "coworker";
}

function getChannelParticipantPreviews(
  channel: ChatRoom,
): ChannelParticipantPreview[] {
  return [
    ...channel.userMembers.map((member) => ({
      id: member.id,
      name: member.name || member.email,
      image: member.image,
      presence: member.presence,
      kind: "human" as const,
    })),
    ...channel.coworkerMembers.map((coworker) => ({
      id: coworker.id,
      name: coworker.name,
      image: coworker.image,
      presence: coworker.presence,
      kind: "coworker" as const,
    })),
  ];
}

function presenceLabel(
  t: (key: "Presence.online" | "Presence.afk" | "Presence.offline") => string,
  presence: ChatRoomPresence,
): string {
  if (presence === "online") {
    return t("Presence.online");
  }
  if (presence === "afk") {
    return t("Presence.afk");
  }
  return t("Presence.offline");
}

function ChannelParticipantStack({ channel }: { channel: ChatRoom }) {
  const t = useTranslations("App.Channels");
  const participants = getChannelParticipantPreviews(channel);
  const visibleParticipants = participants.slice(0, 4);
  const remainingCount = participants.length - visibleParticipants.length;

  if (participants.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        className="flex -space-x-2"
        aria-label={participants
          .map((participant) => participant.name)
          .join(", ")}
      >
        {visibleParticipants.map((participant, index) => (
          <span
            key={`${participant.kind}-${participant.id}`}
            className="relative block size-7 shrink-0"
            style={{ zIndex: visibleParticipants.length - index }}
            title={participant.name}
          >
            <Avatar className="border-background ring-border/60 size-7 border-2 shadow-xs ring-1">
              <AvatarImage src={participant.image ?? undefined} alt="" />
              <AvatarFallback
                className={cn(
                  "text-[10px]",
                  participant.kind === "coworker"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {getInitials(participant.name)}
              </AvatarFallback>
            </Avatar>
            <PresenceDot
              presence={participant.presence}
              label={presenceLabel(t, participant.presence)}
              className="absolute -right-0.5 -bottom-0.5"
            />
          </span>
        ))}
      </div>
      {remainingCount > 0 ? (
        <span className="text-muted-foreground whitespace-nowrap text-xs font-medium">
          {t("participantOverflow", { count: remainingCount })}
        </span>
      ) : null}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatChannelMarkdownMentions({
  content,
  coworkersById,
  coworkersBySlug,
}: {
  content: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
}): string {
  const matches = parseMentions(content);
  if (matches.length === 0) {
    return content;
  }

  let formatted = "";
  let lastIndex = 0;
  matches.forEach((match) => {
    if (match.start > lastIndex) {
      formatted += content.slice(lastIndex, match.start);
    }
    const coworker =
      coworkersById.get(match.id) ?? coworkersBySlug.get(match.slug);
    formatted += `<span class="text-primary font-medium">${escapeHtml(`@${coworker?.name ?? match.id}`)}</span>`;
    lastIndex = match.end;
  });
  if (lastIndex < content.length) {
    formatted += content.slice(lastIndex);
  }

  return formatted;
}

function ChannelMarkdownSegment({
  content,
  coworkersById,
  coworkersBySlug,
}: {
  content: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
}) {
  if (!content.trim()) {
    return null;
  }

  return (
    <Markdown className="prose-p:my-0 prose-p:leading-7 prose-ul:my-1 prose-ol:my-1 prose-pre:my-2">
      {formatChannelMarkdownMentions({
        content,
        coworkersById,
        coworkersBySlug,
      })}
    </Markdown>
  );
}

function ChannelMessageText({
  content,
  coworkersById,
  coworkersBySlug,
}: {
  content: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
}) {
  const fileLinks = findMarkdownLinks(content)
    .map((link) => ({
      ...link,
      url: unescapeMarkdownLinkUrl(link.rawUrl),
    }))
    .filter((link) => isFileLikeUrl(link.url));

  if (fileLinks.length === 0) {
    return (
      <ChannelMarkdownSegment
        content={content}
        coworkersById={coworkersById}
        coworkersBySlug={coworkersBySlug}
      />
    );
  }

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  fileLinks.forEach((link, index) => {
    if (link.index > lastIndex) {
      nodes.push(
        <ChannelMarkdownSegment
          key={`message-${index}-before`}
          content={content.slice(lastIndex, link.index)}
          coworkersById={coworkersById}
          coworkersBySlug={coworkersBySlug}
        />,
      );
    }
    nodes.push(
      <div key={`${link.index}-${link.url}`} className="my-2 flex">
        <FileChipMiniPreviewWithMetadata
          url={link.url}
          fileName={link.text}
          sizeClass="size-16"
        />
      </div>,
    );
    lastIndex = link.index + link.match.length;
  });
  if (lastIndex < content.length) {
    nodes.push(
      <ChannelMarkdownSegment
        key="message-after"
        content={content.slice(lastIndex)}
        coworkersById={coworkersById}
        coworkersBySlug={coworkersBySlug}
      />,
    );
  }

  return <>{nodes}</>;
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

function ChannelComposer({
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
}: {
  value: string;
  onValueChange: Dispatch<SetStateAction<string>>;
  mentions: Record<string, MentionRecordEntry<ChatRoomCoworkerParticipant>>;
  onSelectedKeysChange: (selectedKeys: string[]) => void;
  placeholder: string;
  attachments: ChannelComposerAttachment[];
  onAttachmentsChange: Dispatch<SetStateAction<ChannelComposerAttachment[]>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSending: boolean;
  sendDisabled: boolean;
  /** Channels always; direct rooms only when roster has more than two people. */
  showMentionShortcut?: boolean;
}) {
  const t = useTranslations("App.Channels");
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
      const toastId = toast.loading(
        t("Toolbar.uploading", { count: selectedFiles.length }),
      );

      try {
        const uploadedAttachments: ChannelComposerAttachment[] = [];
        for (const file of selectedFiles) {
          const uploaded = await uploadUserFileDirect(file);
          uploadedAttachments.push({
            url: uploaded.publicUrl,
            fileName: sanitizeTaskAttachmentLabel(
              file.name,
              t("Toolbar.attachmentFallback"),
            ),
            mediaType: file.type || null,
          });
        }

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
          t("Toolbar.uploaded", { count: uploadedAttachments.length }),
          { id: toastId },
        );
      } catch (error) {
        toast.error(
          getUserFileUploadErrorMessage(error, t("Toolbar.uploadFailed")),
          { id: toastId },
        );
      } finally {
        setIsUploadingFiles(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [onAttachmentsChange, onValueChange, t],
  );

  function removeAttachment(attachment: ChannelComposerAttachment) {
    onAttachmentsChange((current) =>
      current.filter((item) => item.url !== attachment.url),
    );
    onValueChange((current) =>
      removeTaskAttachmentLinks(current, [attachment.url]),
    );
    textareaRef.current?.focus();
  }

  return (
    <form ref={formRef} className="shrink-0 px-5 pt-3 pb-6" onSubmit={onSubmit}>
      <div className="w-full">
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-2 px-4 pt-4">
              {attachments.map((attachment) => (
                <FileChipMiniPreviewWithMetadata
                  key={attachment.url}
                  url={attachment.url}
                  fileName={attachment.fileName}
                  mediaType={attachment.mediaType}
                  sizeClass="size-16"
                  onRemove={() => removeAttachment(attachment)}
                  removeLabel={t("Toolbar.removeAttachment", {
                    name: attachment.fileName,
                  })}
                />
              ))}
            </div>
          ) : null}
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
            className="max-h-40 min-h-20 resize-none overflow-y-auto rounded-none border-0! bg-transparent px-4 py-3 text-base ring-0 outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent md:text-sm"
            renderItem={(mention) => <CoworkerSuggestion mention={mention} />}
          />
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="text-muted-foreground flex items-center gap-1">
              {showMentionShortcut ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-full sm:size-8"
                  title={t("Toolbar.mention")}
                  aria-label={t("Toolbar.mention")}
                  onClick={() => textareaRef.current?.openMentions()}
                >
                  <AtSign className="size-4" aria-hidden />
                </Button>
              ) : null}
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
                className="size-9 rounded-full sm:size-8"
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
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 rounded-full sm:size-8"
                    title={t("Toolbar.emoji")}
                    aria-label={t("Toolbar.emoji")}
                  >
                    <SmilePlus className="size-4" aria-hidden />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-2">
                  <div className="grid grid-cols-6 gap-1">
                    {CHANNEL_COMPOSER_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="hover:bg-muted focus-visible:ring-ring flex size-10 items-center justify-center rounded-md text-lg outline-none transition focus-visible:ring-2 sm:size-8"
                        onClick={() => textareaRef.current?.insertText(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <Button
              type="submit"
              variant="primary"
              size="icon"
              className="size-9 rounded-full sm:size-8"
              disabled={isSending || isUploadingFiles || sendDisabled}
              aria-label={t("send")}
            >
              {isSending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ArrowUp className="size-4" aria-hidden />
              )}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

function MessageEmojiPicker({
  onSelect,
  label,
}: {
  onSelect: (emoji: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 rounded-full sm:size-7"
          title={label}
          aria-label={label}
        >
          <SmilePlus className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2">
        <div className="grid grid-cols-6 gap-1">
          {CHANNEL_COMPOSER_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="hover:bg-muted focus-visible:ring-ring flex size-8 items-center justify-center rounded-md text-lg outline-none transition focus-visible:ring-2"
              onClick={() => {
                onSelect(emoji);
                setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ChatMessageRow({
  message,
  coworkersById,
  coworkersBySlug,
  onToggleReaction,
  onOpenThread,
  showThreadButton = true,
}: {
  message: ChatRoomMessage;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  showThreadButton?: boolean;
}) {
  const t = useTranslations("App.Channels");
  const sender = messageSender(message);

  return (
    <article className="group relative -mx-2 flex min-h-11 gap-3.5 rounded-md py-2.5 pr-20 pl-2 transition-colors hover:bg-muted/45">
      <Avatar className="mt-0.5 size-8 shrink-0">
        <AvatarImage src={sender.image ?? undefined} alt="" />
        <AvatarFallback className="text-xs">
          {getInitials(sender.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="truncate text-sm font-semibold">{sender.name}</span>
          {sender.kind === "coworker" ? <AiCoworkerIcon /> : null}
          {/* Formatted in the viewer's locale and timezone, which the server
              does not share, so the SSR text differs from the hydrated text by
              design. */}
          <time
            className="text-muted-foreground text-xs"
            suppressHydrationWarning
          >
            {formatMessageTime(message.createdAt)}
          </time>
        </div>
        <div className="text-foreground wrap-break-word text-sm leading-7">
          <ChannelMessageText
            content={message.content}
            coworkersById={coworkersById}
            coworkersBySlug={coworkersBySlug}
          />
        </div>
        {message.reactions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                onClick={() => onToggleReaction(message, reaction.emoji)}
                className={cn(
                  "border-border bg-background hover:bg-muted inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors sm:h-7 sm:px-2",
                  reaction.reactedByCurrentUser &&
                    "border-primary/30 bg-primary/10 text-primary",
                )}
                aria-label={t("Reactions.toggle", { emoji: reaction.emoji })}
              >
                <span className="text-sm leading-none">{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        ) : null}
        {showThreadButton && message.threadReplyCount > 0 && onOpenThread ? (
          <button
            type="button"
            className="text-primary hover:text-primary/80 -mx-1 mt-1 min-h-9 px-1 text-xs font-medium sm:mt-1 sm:min-h-0"
            onClick={() => onOpenThread(message)}
          >
            {t("Thread.replyCount", { count: message.threadReplyCount })}
          </button>
        ) : null}
        {message.mentions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1.5">
            {message.mentions.map((mention) => (
              <Badge
                key={mention.id}
                variant={
                  mention.status === "failed" ? "destructive" : "outline"
                }
              >
                {mention.status === "responded" ? (
                  <CheckCircle2 className="size-3" />
                ) : mention.status === "failed" ? null : (
                  <Loader2 className="size-3 animate-spin" />
                )}
                {t(`MentionStatus.${mention.status}`)}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      {/* Visible by default; only hover-capable pointers get the reveal-on-hover
          treatment. Tailwind gates `group-hover` behind `@media (hover: hover)`,
          so a touch device never fires it — leaving the only reaction and
          thread controls permanently invisible on a phone. */}
      <div className="border-border bg-background absolute top-1.5 right-2 flex items-center gap-0.5 rounded-full border p-0.5 shadow-sm transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
        <MessageEmojiPicker
          label={t("Reactions.add")}
          onSelect={(emoji) => onToggleReaction(message, emoji)}
        />
        {showThreadButton && onOpenThread ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-full sm:size-7"
            title={t("Thread.open")}
            aria-label={t("Thread.open")}
            onClick={() => onOpenThread(message)}
          >
            <MessageCircle className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function ThreadPanel({
  parentMessage,
  replies,
  isLoading,
  coworkersById,
  coworkersBySlug,
  mentionRecords,
  replyValue,
  onReplyValueChange,
  replyMentionedCoworkerIdsChange,
  replyAttachments,
  onReplyAttachmentsChange,
  onSubmitReply,
  isSendingReply,
  onClose,
  onToggleReaction,
  showMentionShortcut = true,
}: {
  parentMessage: ChatRoomMessage;
  replies: ChatRoomMessage[];
  isLoading: boolean;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  mentionRecords: Record<
    string,
    MentionRecordEntry<ChatRoomCoworkerParticipant>
  >;
  replyValue: string;
  onReplyValueChange: Dispatch<SetStateAction<string>>;
  replyMentionedCoworkerIdsChange: (selectedKeys: string[]) => void;
  replyAttachments: ChannelComposerAttachment[];
  onReplyAttachmentsChange: Dispatch<
    SetStateAction<ChannelComposerAttachment[]>
  >;
  onSubmitReply: (event: FormEvent<HTMLFormElement>) => void;
  isSendingReply: boolean;
  onClose: () => void;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  showMentionShortcut?: boolean;
}) {
  const t = useTranslations("App.Channels");

  return (
    // Below lg the thread takes over the whole pane: side-by-side would leave
    // the message column ~0px wide and push the panel past the viewport edge,
    // taking its close button with it. It has its own header and close button,
    // so a full-screen takeover is self-contained.
    <aside className="bg-background absolute inset-0 z-30 flex min-h-0 w-full shrink-0 flex-col lg:static lg:z-auto lg:w-[420px] lg:border-l">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            {t("Thread.title")}
          </h2>
          <p className="text-muted-foreground truncate text-xs">
            {t("Thread.replyCount", {
              count: parentMessage.threadReplyCount,
            })}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-full"
          aria-label={t("Thread.close")}
          title={t("Thread.close")}
          onClick={onClose}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-4">
          <ChatMessageRow
            message={parentMessage}
            coworkersById={coworkersById}
            coworkersBySlug={coworkersBySlug}
            onToggleReaction={onToggleReaction}
            showThreadButton={false}
          />
          <div className="my-4 border-t" />
          {isLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("Thread.loading")}
            </div>
          ) : replies.length > 0 ? (
            <div className="space-y-1">
              {replies.map((reply) => (
                <ChatMessageRow
                  key={reply.id}
                  message={reply}
                  coworkersById={coworkersById}
                  coworkersBySlug={coworkersBySlug}
                  onToggleReaction={onToggleReaction}
                  showThreadButton={false}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground py-4 text-sm">
              {t("Thread.empty")}
            </p>
          )}
        </div>
      </ScrollArea>
      <ChannelComposer
        value={replyValue}
        onValueChange={onReplyValueChange}
        mentions={mentionRecords}
        onSelectedKeysChange={replyMentionedCoworkerIdsChange}
        placeholder={t("Thread.replyPlaceholder")}
        attachments={replyAttachments}
        onAttachmentsChange={onReplyAttachmentsChange}
        onSubmit={onSubmitReply}
        isSending={isSendingReply}
        sendDisabled={replyValue.trim().length === 0}
        showMentionShortcut={showMentionShortcut}
      />
    </aside>
  );
}

function ParticipantCheckboxes({
  members,
  coworkers,
  memberIds,
  coworkerIds,
  onMemberIdsChange,
  onCoworkerIdsChange,
}: {
  members: Member[];
  coworkers: Coworker[];
  memberIds: string[];
  coworkerIds: string[];
  onMemberIdsChange: (ids: string[]) => void;
  onCoworkerIdsChange: (ids: string[]) => void;
}) {
  const t = useTranslations("App.Channels");
  const [participantQuery, setParticipantQuery] = useState("");
  const normalizedQuery = participantQuery.trim().toLowerCase();
  const selectedCount = memberIds.length + coworkerIds.length;
  const filteredMembers = useMemo(() => {
    if (!normalizedQuery) {
      return members;
    }

    return members.filter((member) =>
      [member.user.name, member.user.email]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [members, normalizedQuery]);
  const filteredCoworkers = useMemo(() => {
    if (!normalizedQuery) {
      return coworkers;
    }

    return coworkers.filter((coworker) =>
      [coworker.name, coworker.slug, coworker.caption]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [coworkers, normalizedQuery]);

  return (
    <div className="rounded-lg border bg-background">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{t("Dialog.participants")}</p>
            <p className="text-muted-foreground text-xs">
              {selectedCount > 0
                ? t("Dialog.selectedParticipants", { count: selectedCount })
                : t("Dialog.createDescription")}
            </p>
          </div>
          <Users className="text-muted-foreground size-4 shrink-0" />
        </div>
        <div className="relative mt-3">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={participantQuery}
            onChange={(event) => setParticipantQuery(event.target.value)}
            placeholder={t("Draft.searchPlaceholder")}
            className="h-9 rounded-full border-0 bg-muted/60 pr-4 pl-9 shadow-none focus-visible:ring-1"
          />
        </div>
      </div>

      <ScrollArea className="h-[300px]">
        <div className="p-2">
          {filteredMembers.length > 0 ? (
            <div className="pb-2">
              <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11px] font-medium">
                {t("Dialog.humans")}
              </div>
              <div className="space-y-0.5">
                {filteredMembers.map((member) => {
                  const checked = memberIds.includes(member.user.id);
                  const displayName = member.user.name || member.user.email;

                  return (
                    <label
                      key={member.user.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors",
                        checked ? "bg-muted/70" : "hover:bg-muted/50",
                      )}
                    >
                      <Avatar className="size-8">
                        <AvatarImage
                          src={member.user.image ?? undefined}
                          alt=""
                        />
                        <AvatarFallback className="text-xs">
                          {getInitials(displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {displayName}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {member.user.email}
                        </span>
                      </span>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          onMemberIdsChange(
                            toggleId(
                              memberIds,
                              member.user.id,
                              nextChecked === true,
                            ),
                          )
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {filteredCoworkers.length > 0 ? (
            <div className="pt-1">
              <div className="text-muted-foreground flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-[11px] font-medium">
                <Bot className="size-3" aria-hidden />
                {t("Dialog.coworkers")}
              </div>
              <div className="space-y-0.5">
                {filteredCoworkers.map((coworker) => {
                  const checked = coworkerIds.includes(coworker.id);

                  return (
                    <label
                      key={coworker.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors",
                        checked ? "bg-muted/70" : "hover:bg-muted/50",
                      )}
                    >
                      <Avatar className="size-8">
                        <AvatarImage src={coworker.image ?? undefined} alt="" />
                        <AvatarFallback className="text-xs">
                          {getInitials(coworker.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {coworker.name}
                          </span>
                          <AiCoworkerIcon />
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          @{coworker.slug}
                        </span>
                      </span>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          onCoworkerIdsChange(
                            toggleId(
                              coworkerIds,
                              coworker.id,
                              nextChecked === true,
                            ),
                          )
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {filteredMembers.length === 0 && filteredCoworkers.length === 0 ? (
            <div className="text-muted-foreground px-4 py-12 text-center text-sm">
              {t("Draft.noResults")}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function EditChannelDialog({
  channel,
  members,
  coworkers,
}: {
  channel: ChatRoom;
  members: Member[];
  coworkers: Coworker[];
}) {
  const t = useTranslations("App.Channels");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [memberIds, setMemberIds] = useState<string[]>(
    channel.userMembers.map((member) => member.id),
  );
  const [coworkerIds, setCoworkerIds] = useState<string[]>(
    channel.coworkerMembers.map((coworker) => coworker.id),
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName(channel.name);
    setTopic(channel.topic ?? "");
    setMemberIds(channel.userMembers.map((member) => member.id));
    setCoworkerIds(channel.coworkerMembers.map((coworker) => coworker.id));
  }, [channel, open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateChannelAction(channel.id, {
        name,
        topic,
        memberUserIds: memberIds,
        coworkerIds,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-full"
          aria-label={t("editChannel")}
          title={t("editChannel")}
        >
          <Settings2 className="size-4" aria-hidden />
        </Button>
      </DialogTrigger>
      {/* The fixed-height participant list makes this dialog ~755px tall, which
          overflows a shorter phone — on a 667px iPhone SE the title and close
          button were cut off above the viewport and Cancel below it, with
          nothing to scroll. Cap it to the viewport and scroll the body. */}
      {/* The fixed-height participant list makes this dialog ~755px tall, which
          overflows a shorter phone — on a 667px iPhone SE the title and close
          button sat above the viewport and Cancel below it, with nothing to
          scroll. Cap the dialog to the viewport and scroll the form body rather
          than the padded dialog box, whose children do not reflow around their
          own scrollbar. */}
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto shadow-none sm:max-w-2xl">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("Dialog.editTitle")}</DialogTitle>
            <DialogDescription>{t("Dialog.editDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-channel-name">{t("Dialog.name")}</Label>
              <Input
                id="edit-channel-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-channel-topic">{t("Dialog.topic")}</Label>
              <Textarea
                id="edit-channel-topic"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                rows={3}
              />
            </div>
            <ParticipantCheckboxes
              members={members}
              coworkers={coworkers}
              memberIds={memberIds}
              coworkerIds={coworkerIds}
              onMemberIdsChange={setMemberIds}
              onCoworkerIdsChange={setCoworkerIds}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {t("Dialog.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("Dialog.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DirectDraftTarget {
  key: string;
  id: string;
  name: string;
  detail: string;
  image: string | null;
  kind: "human" | "coworker";
  slug?: string;
  caption?: string | null;
  presence?: ChatRoomPresence;
}

function buildDirectDraftTargets(
  members: Member[],
  coworkers: Coworker[],
  currentUserId: string,
): DirectDraftTarget[] {
  return [
    ...coworkers.map((coworker) => ({
      key: `coworker:${coworker.id}`,
      id: coworker.id,
      name: coworker.name,
      detail: coworker.caption ?? (coworker.slug ? `@${coworker.slug}` : ""),
      image: coworker.image ?? null,
      kind: "coworker" as const,
      slug: coworker.slug,
      caption: coworker.caption,
      presence: "online" as const,
    })),
    ...members
      .filter((member) => member.user.id !== currentUserId)
      .map((member) => ({
        key: `human:${member.user.id}`,
        id: member.user.id,
        name: member.user.name || member.user.email,
        detail: member.user.email,
        image: member.user.image ?? null,
        kind: "human" as const,
      })),
  ];
}

function DirectDraftTargetRow({
  target,
  onSelect,
}: {
  target: DirectDraftTarget;
  onSelect: (target: DirectDraftTarget) => void;
}) {
  return (
    <button
      type="button"
      className="hover:bg-muted/70 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors"
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect(target);
      }}
    >
      <Avatar className="size-7 shrink-0">
        <AvatarImage src={target.image ?? undefined} alt="" />
        <AvatarFallback className="text-[10px]">
          {getInitials(target.name)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{target.name}</span>
          {target.kind === "coworker" ? <AiCoworkerIcon /> : null}
        </span>
        {target.detail ? (
          <span className="text-muted-foreground block truncate text-xs">
            {target.detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function DraftChannel({
  members,
  coworkers,
  currentUserId,
}: {
  members: Member[];
  coworkers: Coworker[];
  currentUserId: string;
}) {
  const t = useTranslations("App.Channels");
  const router = useRouter();
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [recipientQuery, setRecipientQuery] = useState("");
  const [isRecipientPickerOpen, setIsRecipientPickerOpen] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<
    ChannelComposerAttachment[]
  >([]);
  const [mentionedCoworkerIds, setMentionedCoworkerIds] = useState<string[]>(
    [],
  );
  const [isCreating, startCreatingTransition] = useTransition();
  const targets = useMemo(
    () => buildDirectDraftTargets(members, coworkers, currentUserId),
    [members, coworkers, currentUserId],
  );
  const selectedTargets = useMemo(() => {
    const byKey = new Map(targets.map((target) => [target.key, target]));
    return selectedKeys
      .map((key) => byKey.get(key))
      .filter((target): target is DirectDraftTarget => Boolean(target));
  }, [selectedKeys, targets]);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const normalizedQuery = recipientQuery.trim().toLowerCase();
  const candidateTargets = useMemo(() => {
    return targets
      .filter((target) => !selectedKeySet.has(target.key))
      .filter((target) => {
        if (!normalizedQuery) {
          return true;
        }
        return [target.name, target.detail, target.slug ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .slice(0, 8);
  }, [normalizedQuery, selectedKeySet, targets]);
  const selectedCoworkerParticipants = useMemo<
    Record<string, MentionRecordEntry<ChatRoomCoworkerParticipant>>
  >(() => {
    return Object.fromEntries(
      selectedTargets
        .filter((target) => target.kind === "coworker" && target.slug)
        .map((target) => [
          target.id,
          {
            value: target.name,
            slug: target.slug ?? target.id,
            data: {
              id: target.id,
              name: target.name,
              slug: target.slug ?? target.id,
              caption: target.caption ?? null,
              image: target.image,
              presence: target.presence ?? "online",
            },
          },
        ]),
    );
  }, [selectedTargets]);
  const selectedMemberUserIds = selectedTargets
    .filter((target) => target.kind === "human")
    .map((target) => target.id);
  const selectedCoworkerIds = selectedTargets
    .filter((target) => target.kind === "coworker")
    .map((target) => target.id);
  const trimmedName = name.trim();
  const displayName = trimmedName || t("Dialog.createTitle");

  function addTarget(target: DirectDraftTarget) {
    setSelectedKeys((current) =>
      current.includes(target.key) ? current : [...current, target.key],
    );
    setRecipientQuery("");
    setIsRecipientPickerOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function removeTarget(key: string) {
    setSelectedKeys((current) => current.filter((item) => item !== key));
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = composerValue.trim();
    if (!trimmedName) {
      toast.error(t("Dialog.nameRequired"));
      nameInputRef.current?.focus();
      return;
    }
    if (!content) {
      return;
    }

    startCreatingTransition(async () => {
      const result = await sendNewChannelMessageAction({
        name: trimmedName,
        topic,
        memberUserIds: selectedMemberUserIds,
        coworkerIds: selectedCoworkerIds,
        content,
        mentionedCoworkerIds,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setName("");
      setTopic("");
      setSelectedKeys([]);
      setComposerValue("");
      setComposerAttachments([]);
      setMentionedCoworkerIds([]);
      router.replace(`/channels?channel=${result.data.channel.id}`);
      // No speculative refresh burst for coworker replies: the destination
      // view already polls while a mention is unresolved, and these timers
      // outlived the component — they fired against whatever page the user had
      // navigated to.
      router.refresh();
    });
  }

  return (
    <>
      <header className="min-h-14 shrink-0 border-b px-5 py-2">
        <div className="space-y-2">
          <div className="flex w-full items-start gap-2">
            <Hash
              className="text-muted-foreground mt-2 size-4 shrink-0"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <input
                ref={nameInputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("Dialog.namePlaceholder")}
                className="placeholder:text-muted-foreground h-8 w-full bg-transparent text-base font-medium outline-none md:text-sm"
              />
              <input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder={t("Dialog.topicPlaceholder")}
                className="placeholder:text-muted-foreground/80 text-muted-foreground h-6 w-full bg-transparent text-base outline-none md:text-xs"
              />
            </div>
          </div>

          <div className="relative flex w-full items-start gap-2">
            <span className="text-muted-foreground pt-2 text-sm font-medium">
              {t("Dialog.participants")}
            </span>
            <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {selectedTargets.map((target) => (
                <span
                  key={target.key}
                  className="bg-muted text-foreground inline-flex max-w-56 items-center gap-1.5 rounded-full py-1 pr-1 pl-1.5 text-sm"
                >
                  <Avatar className="size-5">
                    <AvatarImage src={target.image ?? undefined} alt="" />
                    <AvatarFallback className="text-[9px]">
                      {getInitials(target.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate">{target.name}</span>
                    {target.kind === "coworker" ? (
                      <AiCoworkerIcon className="size-3" />
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="hover:bg-background/80 relative flex size-5 items-center justify-center rounded-full before:absolute before:-inset-2 before:content-['']"
                    onClick={() => removeTarget(target.key)}
                    aria-label={t("Draft.removeRecipient", {
                      name: target.name,
                    })}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
              <div className="relative min-w-44 flex-1">
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-0 size-4 -translate-y-1/2"
                  aria-hidden
                />
                <input
                  ref={searchInputRef}
                  value={recipientQuery}
                  onChange={(event) => {
                    setRecipientQuery(event.target.value);
                    setIsRecipientPickerOpen(true);
                  }}
                  onFocus={() => setIsRecipientPickerOpen(true)}
                  onBlur={() => {
                    window.setTimeout(
                      () => setIsRecipientPickerOpen(false),
                      120,
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && candidateTargets[0]) {
                      event.preventDefault();
                      addTarget(candidateTargets[0]);
                    }
                    if (
                      event.key === "Backspace" &&
                      recipientQuery.length === 0 &&
                      selectedKeys.length > 0
                    ) {
                      removeTarget(selectedKeys[selectedKeys.length - 1]);
                    }
                  }}
                  placeholder={
                    selectedTargets.length === 0
                      ? t("Draft.searchPlaceholder")
                      : t("Draft.searchPlaceholderMore")
                  }
                  className="placeholder:text-muted-foreground h-9 w-full bg-transparent pr-2 pl-6 text-base outline-none md:text-sm"
                />
              </div>
            </div>
            {isRecipientPickerOpen ? (
              <div className="bg-popover text-popover-foreground border-border absolute top-full right-0 left-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-md border p-1 shadow-lg">
                {candidateTargets.length > 0 ? (
                  candidateTargets.map((target) => (
                    <DirectDraftTargetRow
                      key={target.key}
                      target={target}
                      onSelect={addTarget}
                    />
                  ))
                ) : (
                  <p className="text-muted-foreground px-3 py-4 text-sm">
                    {t("Draft.noResults")}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full w-full items-center justify-center px-5 py-10">
          <div className="max-w-md text-center">
            <Hash className="text-muted-foreground mx-auto size-8" />
            <h2 className="mt-4 text-lg font-semibold">
              {trimmedName ? `# ${displayName}` : t("Dialog.createTitle")}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {selectedTargets.length > 0
                ? t("Dialog.selectedParticipants", {
                    count: selectedTargets.length,
                  })
                : t("Empty.noChannelDescription")}
            </p>
          </div>
        </div>
      </ScrollArea>

      <ChannelComposer
        value={composerValue}
        onValueChange={setComposerValue}
        mentions={selectedCoworkerParticipants}
        onSelectedKeysChange={setMentionedCoworkerIds}
        placeholder={
          trimmedName
            ? t("Draft.composerPlaceholder")
            : t("Dialog.namePlaceholder")
        }
        attachments={composerAttachments}
        onAttachmentsChange={setComposerAttachments}
        onSubmit={handleCreate}
        isSending={isCreating}
        sendDisabled={trimmedName.length === 0 || composerValue.trim() === ""}
      />
    </>
  );
}

function DraftDirectMessage({
  members,
  coworkers,
  currentUserId,
}: {
  members: Member[];
  coworkers: Coworker[];
  currentUserId: string;
}) {
  const t = useTranslations("App.Channels");
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [isRecipientPickerOpen, setIsRecipientPickerOpen] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<
    ChannelComposerAttachment[]
  >([]);
  const [mentionedCoworkerIds, setMentionedCoworkerIds] = useState<string[]>(
    [],
  );
  const [isSending, startSendingTransition] = useTransition();
  const targets = useMemo(
    () => buildDirectDraftTargets(members, coworkers, currentUserId),
    [members, coworkers, currentUserId],
  );
  const selectedTargets = useMemo(() => {
    const byKey = new Map(targets.map((target) => [target.key, target]));
    return selectedKeys
      .map((key) => byKey.get(key))
      .filter((target): target is DirectDraftTarget => Boolean(target));
  }, [selectedKeys, targets]);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const normalizedQuery = recipientQuery.trim().toLowerCase();
  const candidateTargets = useMemo(() => {
    return targets
      .filter((target) => !selectedKeySet.has(target.key))
      .filter((target) => {
        if (!normalizedQuery) {
          return true;
        }
        return [target.name, target.detail, target.slug ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .slice(0, 8);
  }, [normalizedQuery, selectedKeySet, targets]);
  const selectedCoworkerParticipants = useMemo<
    Record<string, MentionRecordEntry<ChatRoomCoworkerParticipant>>
  >(() => {
    return Object.fromEntries(
      selectedTargets
        .filter((target) => target.kind === "coworker" && target.slug)
        .map((target) => [
          target.id,
          {
            value: target.name,
            slug: target.slug ?? target.id,
            data: {
              id: target.id,
              name: target.name,
              slug: target.slug ?? target.id,
              caption: target.caption ?? null,
              image: target.image,
              presence: target.presence ?? "online",
            },
          },
        ]),
    );
  }, [selectedTargets]);
  const selectedMemberUserIds = selectedTargets
    .filter((target) => target.kind === "human")
    .map((target) => target.id);
  const selectedCoworkerIds = selectedTargets
    .filter((target) => target.kind === "coworker")
    .map((target) => target.id);

  function addTarget(target: DirectDraftTarget) {
    setSelectedKeys((current) =>
      current.includes(target.key) ? current : [...current, target.key],
    );
    setRecipientQuery("");
    setIsRecipientPickerOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function removeTarget(key: string) {
    setSelectedKeys((current) => current.filter((item) => item !== key));
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = composerValue.trim();
    if (!content) {
      return;
    }
    if (selectedTargets.length === 0) {
      toast.error(t("Draft.chooseRecipientError"));
      searchInputRef.current?.focus();
      return;
    }

    if (
      selectedMemberUserIds.length === 0 &&
      selectedCoworkerIds.length === 1
    ) {
      const coworkerTarget = selectedTargets.find(
        (target) => target.kind === "coworker",
      );
      if (coworkerTarget) {
        const coworkerRouteId = coworkerTarget.slug || coworkerTarget.id;
        const coworkerRouteSlug =
          slugify(coworkerRouteId) ||
          slugify(coworkerTarget.name) ||
          coworkerTarget.id;
        writePendingCoworkerDirectMessage({
          coworkerId: coworkerTarget.id,
          coworkerSlug: coworkerRouteId,
          content,
          createdAt: Date.now(),
        });
        router.push(
          `${CHAT_APP_ROUTE_PREFIX}/${coworkerRouteSlug}?coworker=${encodeURIComponent(coworkerRouteId)}`,
        );
        return;
      }
    }

    startSendingTransition(async () => {
      const result = await sendNewDirectMessageAction({
        memberUserIds: selectedMemberUserIds,
        coworkerIds: selectedCoworkerIds,
        content,
        mentionedCoworkerIds,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setComposerValue("");
      setComposerAttachments([]);
      setMentionedCoworkerIds([]);
      router.replace(`/channels?channel=${result.data.channel.id}`);
      // No speculative refresh burst for coworker replies: the destination
      // view already polls while a mention is unresolved, and these timers
      // outlived the component — they fired against whatever page the user had
      // navigated to.
      router.refresh();
    });
  }

  return (
    <>
      <header className="min-h-14 shrink-0 border-b px-5 py-2">
        <div className="relative flex w-full items-start gap-2">
          <span className="text-muted-foreground pt-2 text-sm font-medium">
            {t("Draft.to")}
          </span>
          <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {selectedTargets.map((target) => (
              <span
                key={target.key}
                className="bg-muted text-foreground inline-flex max-w-56 items-center gap-1.5 rounded-full py-1 pr-1 pl-1.5 text-sm"
              >
                <Avatar className="size-5">
                  <AvatarImage src={target.image ?? undefined} alt="" />
                  <AvatarFallback className="text-[9px]">
                    {getInitials(target.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate">{target.name}</span>
                  {target.kind === "coworker" ? (
                    <AiCoworkerIcon className="size-3" />
                  ) : null}
                </span>
                <button
                  type="button"
                  className="hover:bg-background/80 flex size-5 items-center justify-center rounded-full"
                  onClick={() => removeTarget(target.key)}
                  aria-label={t("Draft.removeRecipient", {
                    name: target.name,
                  })}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
            <div className="relative min-w-44 flex-1">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-0 size-4 -translate-y-1/2"
                aria-hidden
              />
              <input
                ref={searchInputRef}
                value={recipientQuery}
                onChange={(event) => {
                  setRecipientQuery(event.target.value);
                  setIsRecipientPickerOpen(true);
                }}
                onFocus={() => setIsRecipientPickerOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setIsRecipientPickerOpen(false), 120);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && candidateTargets[0]) {
                    event.preventDefault();
                    addTarget(candidateTargets[0]);
                  }
                  if (
                    event.key === "Backspace" &&
                    recipientQuery.length === 0 &&
                    selectedKeys.length > 0
                  ) {
                    removeTarget(selectedKeys[selectedKeys.length - 1]);
                  }
                }}
                placeholder={
                  selectedTargets.length === 0
                    ? t("Draft.searchPlaceholder")
                    : t("Draft.searchPlaceholderMore")
                }
                className="placeholder:text-muted-foreground h-9 w-full bg-transparent pr-2 pl-6 text-base outline-none md:text-sm"
              />
            </div>
          </div>
          {isRecipientPickerOpen ? (
            <div className="bg-popover text-popover-foreground border-border absolute top-full right-0 left-8 z-20 mt-1 max-h-72 overflow-y-auto rounded-md border p-1 shadow-lg">
              {candidateTargets.length > 0 ? (
                candidateTargets.map((target) => (
                  <DirectDraftTargetRow
                    key={target.key}
                    target={target}
                    onSelect={addTarget}
                  />
                ))
              ) : (
                <p className="text-muted-foreground px-3 py-4 text-sm">
                  {t("Draft.noResults")}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full w-full items-center justify-center px-5 py-10">
          <div className="max-w-md text-center">
            <MessageCircle className="text-muted-foreground mx-auto size-8" />
            <h2 className="mt-4 text-lg font-semibold">{t("Draft.title")}</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {selectedTargets.length > 0
                ? t("Draft.ready", { count: selectedTargets.length })
                : t("Draft.empty")}
            </p>
          </div>
        </div>
      </ScrollArea>

      <ChannelComposer
        value={composerValue}
        onValueChange={setComposerValue}
        mentions={selectedCoworkerParticipants}
        onSelectedKeysChange={setMentionedCoworkerIds}
        placeholder={
          selectedTargets.length > 0
            ? t("Draft.composerPlaceholder")
            : t("Draft.composerPlaceholderNoRecipients")
        }
        attachments={composerAttachments}
        onAttachmentsChange={setComposerAttachments}
        onSubmit={handleSend}
        isSending={isSending}
        sendDisabled={
          composerValue.trim().length === 0 || selectedTargets.length === 0
        }
        showMentionShortcut={selectedTargets.length > 1}
      />
    </>
  );
}

export function ChannelsClient({
  activeOrganization,
  channels,
  organizationMembers,
  currentUserId,
  coworkers,
  selectedChannelId,
  isCreateChannelRequested,
  isNewDirectMessage,
  messageLoadFailed,
  messages,
  messagesNextCursor,
}: ChannelsClientProps) {
  const t = useTranslations("App.Channels");
  const tBreadcrumb = useTranslations("Components.Breadcrumb");
  const router = useRouter();
  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<
    ChannelComposerAttachment[]
  >([]);
  const [mentionedCoworkerIds, setMentionedCoworkerIds] = useState<string[]>(
    [],
  );
  const [messagesState, setMessagesState] =
    useState<ChatRoomMessage[]>(messages);
  const [olderNextCursor, setOlderNextCursor] = useState<string | null>(
    messagesNextCursor,
  );
  const [threadParentMessage, setThreadParentMessage] =
    useState<ChatRoomMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<ChatRoomMessage[]>([]);
  const [threadComposerValue, setThreadComposerValue] = useState("");
  const [threadComposerAttachments, setThreadComposerAttachments] = useState<
    ChannelComposerAttachment[]
  >([]);
  const [threadMentionedCoworkerIds, setThreadMentionedCoworkerIds] = useState<
    string[]
  >([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const readMarkerRef = useRef<string | null>(null);
  const [isSending, startSendingTransition] = useTransition();
  const [isThreadLoading, startThreadLoadingTransition] = useTransition();
  const [isSendingThreadReply, startSendingThreadReplyTransition] =
    useTransition();
  const [_isReacting, startReactionTransition] = useTransition();
  const [isLoadingOlder, startLoadingOlderTransition] = useTransition();
  const pendingReactionsRef = useRef<Set<string>>(new Set());
  const selectedChannel = isNewDirectMessage
    ? null
    : (channels.find((channel) => channel.id === selectedChannelId) ?? null);
  const selectedChannelDisplayName = selectedChannel
    ? getChannelDisplayName(selectedChannel, currentUserId)
    : "";
  const isDirectChannel = selectedChannel?.kind === "direct";
  const breadcrumbOverride = useMemo(
    () => ({
      pathname: "/channels",
      segments: [
        {
          label: tBreadcrumb("chat"),
          href: "/chat",
        },
        ...(selectedChannel
          ? [
              {
                label: selectedChannelDisplayName,
                href: `/channels?channel=${selectedChannel.id}`,
              },
            ]
          : isCreateChannelRequested
            ? [
                {
                  label: t("Dialog.createTitle"),
                  href: "/channels?create=channel",
                },
              ]
            : isNewDirectMessage
              ? [
                  {
                    label: t("Draft.breadcrumb"),
                    href: "/channels?dm=new",
                  },
                ]
              : []),
      ],
    }),
    [
      selectedChannel,
      selectedChannelDisplayName,
      isCreateChannelRequested,
      isNewDirectMessage,
      t,
      tBreadcrumb,
    ],
  );
  useRegisterBreadcrumbOverride(breadcrumbOverride);
  const coworkersById = useMemo(() => {
    return new Map(
      (selectedChannel?.coworkerMembers ?? []).map((coworker) => [
        coworker.id,
        coworker,
      ]),
    );
  }, [selectedChannel]);
  const coworkersBySlug = useMemo(() => {
    return new Map(
      (selectedChannel?.coworkerMembers ?? []).map((coworker) => [
        coworker.slug,
        coworker,
      ]),
    );
  }, [selectedChannel]);
  const mentionRecords = useMemo<
    Record<string, MentionRecordEntry<ChatRoomCoworkerParticipant>>
  >(() => {
    return Object.fromEntries(
      (selectedChannel?.coworkerMembers ?? []).map((coworker) => [
        coworker.id,
        {
          value: coworker.name,
          slug: coworker.slug,
          data: coworker,
        },
      ]),
    );
  }, [selectedChannel]);

  useEffect(() => {
    setMessagesState(messages);
    setOlderNextCursor(messagesNextCursor);
    setThreadParentMessage((current) =>
      current
        ? (messages.find((message) => message.id === current.id) ?? current)
        : current,
    );
  }, [messages, messagesNextCursor]);

  useEffect(() => {
    setComposerValue("");
    setComposerAttachments([]);
    setMentionedCoworkerIds([]);
    setThreadParentMessage(null);
    setThreadMessages([]);
    setThreadComposerValue("");
    setThreadComposerAttachments([]);
    setThreadMentionedCoworkerIds([]);
  }, [selectedChannelId, isNewDirectMessage, isCreateChannelRequested]);

  // Scroll on channel switch or when the newest message changes — not when
  // an older page is prepended (length grows, last id stays the same).
  const latestMessageId = messagesState.at(-1)?.id ?? null;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [latestMessageId, selectedChannelId]);

  const latestVisibleMessageId = messagesState.at(-1)?.id ?? "empty";
  const selectedChannelReadId = selectedChannel?.id ?? null;

  useEffect(() => {
    if (!selectedChannelReadId) {
      return;
    }

    const marker = `${selectedChannelReadId}:${latestVisibleMessageId}`;
    if (readMarkerRef.current === marker) {
      return;
    }
    readMarkerRef.current = marker;

    let cancelled = false;
    markOrganizationChatChannelReadAction(selectedChannelReadId).then(
      (result) => {
        if (cancelled || !result.ok) {
          return;
        }
        window.dispatchEvent(
          new CustomEvent("organization-chat-channel-read", {
            detail: { channel: result.data, channelId: selectedChannelReadId },
          }),
        );
      },
    );

    return () => {
      cancelled = true;
    };
  }, [latestVisibleMessageId, selectedChannelReadId]);

  const hasPendingChannelCoworkerMention = useMemo(
    () => hasPendingCoworkerMention(messagesState),
    [messagesState],
  );
  const hasPendingThreadCoworkerMention = useMemo(
    () => hasPendingCoworkerMention(threadMessages),
    [threadMessages],
  );

  useEffect(() => {
    if (!selectedChannel || !hasPendingChannelCoworkerMention) {
      return;
    }

    const channelId = selectedChannel.id;
    let cancelled = false;
    let timeoutId: number | undefined;

    let attempts = 0;

    const pollMessages = async () => {
      // A mention that never reaches a terminal state used to poll forever, in
      // background tabs too. Skip ticks while hidden and give up after a bound;
      // `visibilitychange` restarts the loop when the user comes back.
      if (document.visibilityState !== "visible") {
        timeoutId = window.setTimeout(pollMessages, COWORKER_RESPONSE_POLL_MS);
        return;
      }
      if (attempts >= COWORKER_RESPONSE_POLL_MAX_ATTEMPTS) {
        return;
      }
      attempts += 1;
      const result = await listChannelMessagesAction(channelId);
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setMessagesState((current) =>
          mergeChannelMessages(current, result.data.messages),
        );
        setThreadParentMessage((current) =>
          current
            ? (result.data.messages.find(
                (message) => message.id === current.id,
              ) ?? current)
            : current,
        );
      }
      timeoutId = window.setTimeout(pollMessages, COWORKER_RESPONSE_POLL_MS);
    };

    const restartWhenVisible = () => {
      if (document.visibilityState === "visible") {
        attempts = 0;
      }
    };
    document.addEventListener("visibilitychange", restartWhenVisible);

    timeoutId = window.setTimeout(pollMessages, COWORKER_RESPONSE_POLL_MS);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", restartWhenVisible);
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [selectedChannel?.id, hasPendingChannelCoworkerMention]);

  // Peer traffic while the channel stays open: light poll + focus/visibility
  // refetch. Merges into local state so previously loaded older pages survive.
  useEffect(() => {
    if (!selectedChannel) {
      return;
    }

    const channelId = selectedChannel.id;
    let cancelled = false;

    const refreshLatest = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      const result = await listChannelMessagesAction(channelId);
      if (cancelled || !result.ok) {
        return;
      }
      setMessagesState((current) =>
        mergeChannelMessages(current, result.data.messages),
      );
      setThreadParentMessage((current) =>
        current
          ? (result.data.messages.find(
              (message) => message.id === current.id,
            ) ?? current)
          : current,
      );
    };

    const intervalId = window.setInterval(refreshLatest, CHANNEL_LIVE_POLL_MS);
    window.addEventListener("focus", refreshLatest);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshLatest();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshLatest);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedChannel?.id]);

  useEffect(() => {
    if (
      !selectedChannel ||
      !threadParentMessage ||
      !hasPendingThreadCoworkerMention
    ) {
      return;
    }

    const channelId = selectedChannel.id;
    const parentMessageId = threadParentMessage.id;
    let cancelled = false;
    let timeoutId: number | undefined;

    let threadAttempts = 0;

    const pollThreadMessages = async () => {
      // Same gating as the channel poll above.
      if (document.visibilityState !== "visible") {
        timeoutId = window.setTimeout(
          pollThreadMessages,
          COWORKER_RESPONSE_POLL_MS,
        );
        return;
      }
      if (threadAttempts >= COWORKER_RESPONSE_POLL_MAX_ATTEMPTS) {
        return;
      }
      threadAttempts += 1;
      const [threadResult, channelResult] = await Promise.all([
        listThreadMessagesAction(channelId, parentMessageId),
        listChannelMessagesAction(channelId),
      ]);
      if (cancelled) {
        return;
      }
      if (threadResult.ok) {
        setThreadMessages(threadResult.data);
      }
      if (channelResult.ok) {
        setMessagesState((current) =>
          mergeChannelMessages(current, channelResult.data.messages),
        );
        setThreadParentMessage((current) =>
          current
            ? (channelResult.data.messages.find(
                (message) => message.id === current.id,
              ) ?? current)
            : current,
        );
      }
      timeoutId = window.setTimeout(
        pollThreadMessages,
        COWORKER_RESPONSE_POLL_MS,
      );
    };

    timeoutId = window.setTimeout(
      pollThreadMessages,
      COWORKER_RESPONSE_POLL_MS,
    );

    const restartThreadWhenVisible = () => {
      if (document.visibilityState === "visible") {
        threadAttempts = 0;
      }
    };
    document.addEventListener("visibilitychange", restartThreadWhenVisible);

    return () => {
      cancelled = true;
      document.removeEventListener(
        "visibilitychange",
        restartThreadWhenVisible,
      );
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    selectedChannel?.id,
    threadParentMessage?.id,
    hasPendingThreadCoworkerMention,
  ]);

  function mergeUpdatedMessage(updatedMessage: ChatRoomMessage) {
    setMessagesState((current) =>
      current.map((message) =>
        message.id === updatedMessage.id ? updatedMessage : message,
      ),
    );
    setThreadMessages((current) =>
      current.map((message) =>
        message.id === updatedMessage.id ? updatedMessage : message,
      ),
    );
    setThreadParentMessage((current) =>
      current?.id === updatedMessage.id ? updatedMessage : current,
    );
  }

  function updateParentThreadPreview(
    parentMessageId: string,
    reply: ChatRoomMessage,
  ) {
    const updateParent = (message: ChatRoomMessage): ChatRoomMessage =>
      message.id === parentMessageId
        ? {
            ...message,
            threadReplyCount: message.threadReplyCount + 1,
            threadLastReplyAt: reply.createdAt,
          }
        : message;

    setMessagesState((current) => current.map(updateParent));
    setThreadParentMessage((current) =>
      current ? updateParent(current) : null,
    );
  }

  function loadThreadMessages(parentMessage: ChatRoomMessage) {
    if (!selectedChannel) return;
    setThreadParentMessage(parentMessage);
    setThreadMessages([]);
    startThreadLoadingTransition(async () => {
      const result = await listThreadMessagesAction(
        selectedChannel.id,
        parentMessage.id,
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setThreadMessages(result.data);
    });
  }

  function handleLoadOlderMessages() {
    if (!selectedChannel || !olderNextCursor || isLoadingOlder) {
      return;
    }

    const channelId = selectedChannel.id;
    const cursor = olderNextCursor;
    startLoadingOlderTransition(async () => {
      const result = await listChannelMessagesAction(channelId, { cursor });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setMessagesState((current) =>
        mergeChannelMessages(current, result.data.messages),
      );
      setOlderNextCursor(result.data.nextCursor);
    });
  }

  function handleToggleReaction(message: ChatRoomMessage, emoji: string) {
    if (!selectedChannel) return;
    // Guard the in-flight toggle: on a slow connection nothing changed
    // visibly, so users tapped again and the second call flipped the reaction
    // straight back off.
    const pendingKey = `${message.id}:${emoji}`;
    if (pendingReactionsRef.current.has(pendingKey)) return;
    pendingReactionsRef.current.add(pendingKey);
    startReactionTransition(async () => {
      const result = await toggleMessageReactionAction(
        selectedChannel.id,
        message.id,
        emoji,
      );
      pendingReactionsRef.current.delete(pendingKey);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      mergeUpdatedMessage(result.data);
    });
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChannel) return;
    const content = composerValue.trim();
    if (!content) return;

    startSendingTransition(async () => {
      const result = await sendChannelMessageAction(
        selectedChannel.id,
        content,
        mentionedCoworkerIds,
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setMessagesState((current) => appendMessage(current, result.data));
      setComposerValue("");
      setComposerAttachments([]);
      setMentionedCoworkerIds([]);
      // The action already calls revalidatePath("/channels"); refreshing here
      // too would re-render the whole route a second time per message.
    });
  }

  function handleSendThreadReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChannel || !threadParentMessage) return;
    const content = threadComposerValue.trim();
    if (!content) return;

    startSendingThreadReplyTransition(async () => {
      const result = await sendChannelMessageAction(
        selectedChannel.id,
        content,
        threadMentionedCoworkerIds,
        threadParentMessage.id,
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      setThreadMessages((current) => [...current, result.data]);
      updateParentThreadPreview(threadParentMessage.id, result.data);
      setThreadComposerValue("");
      setThreadComposerAttachments([]);
      setThreadMentionedCoworkerIds([]);
      // Same as the channel composer: the action's revalidatePath covers this.
    });
  }

  return (
    <div className="-m-4 flex h-[calc(100svh-64px)] min-h-0 flex-col overflow-hidden bg-background">
      {/* `relative` anchors the thread panel's mobile full-screen takeover. */}
      <main className="relative flex min-h-0 flex-1">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {isCreateChannelRequested ? (
            <DraftChannel
              members={organizationMembers}
              coworkers={coworkers}
              currentUserId={currentUserId}
            />
          ) : isNewDirectMessage ? (
            <DraftDirectMessage
              members={organizationMembers}
              coworkers={coworkers}
              currentUserId={currentUserId}
            />
          ) : selectedChannel ? (
            <>
              <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-6">
                <div className="flex min-w-0 items-center gap-2">
                  {isDirectChannel ? (
                    <MessageCircle className="text-muted-foreground size-4 shrink-0" />
                  ) : (
                    <Hash className="text-muted-foreground size-4 shrink-0" />
                  )}
                  <p className="text-muted-foreground truncate text-sm">
                    {isDirectChannel
                      ? getDirectChannelSubtitle(
                          selectedChannel,
                          currentUserId,
                          {
                            fallback: activeOrganization.name,
                            participantCountLabel: (count) =>
                              t("directParticipantCount", { count }),
                          },
                        )
                      : selectedChannelDisplayName}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ChannelParticipantStack channel={selectedChannel} />
                  {isDirectChannel ? null : (
                    <EditChannelDialog
                      channel={selectedChannel}
                      members={organizationMembers}
                      coworkers={coworkers}
                    />
                  )}
                </div>
              </header>

              <ScrollArea className="min-h-0 flex-1">
                <div className="flex w-full flex-col px-5 pt-6 pb-8">
                  {messageLoadFailed ? (
                    <div className="border-border/70 bg-muted/20 rounded-md border border-dashed px-5 py-10 text-center">
                      <p className="font-medium">
                        {t("Empty.messagesLoadFailedTitle")}
                      </p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {t("Empty.messagesLoadFailedDescription")}
                      </p>
                    </div>
                  ) : messagesState.length === 0 ? (
                    <div className="border-border/70 bg-muted/20 rounded-md border border-dashed px-5 py-10 text-center">
                      <p className="font-medium">
                        {t("Empty.noMessagesTitle")}
                      </p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {t("Empty.noMessagesDescription")}
                      </p>
                    </div>
                  ) : null}
                  {olderNextCursor ? (
                    <div className="mb-4 flex justify-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isLoadingOlder}
                        onClick={handleLoadOlderMessages}
                      >
                        {isLoadingOlder ? (
                          <>
                            <Loader2 className="size-4 animate-spin" />
                            {t("loadingOlder")}
                          </>
                        ) : (
                          t("loadOlder")
                        )}
                      </Button>
                    </div>
                  ) : null}
                  {messagesState.map((message, index) => {
                    const previousMessage = messagesState[index - 1];
                    const showDaySeparator =
                      !previousMessage ||
                      messageDayKey(previousMessage.createdAt) !==
                        messageDayKey(message.createdAt);
                    return (
                      <div key={message.id}>
                        {showDaySeparator ? (
                          <DaySeparator
                            date={new Date(message.createdAt)}
                            formatDaySeparator={formatDaySeparator}
                          />
                        ) : null}
                        <ChatMessageRow
                          message={message}
                          coworkersById={coworkersById}
                          coworkersBySlug={coworkersBySlug}
                          onToggleReaction={handleToggleReaction}
                          onOpenThread={loadThreadMessages}
                        />
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              </ScrollArea>

              <ChannelComposer
                value={composerValue}
                onValueChange={setComposerValue}
                mentions={mentionRecords}
                onSelectedKeysChange={setMentionedCoworkerIds}
                placeholder={
                  isDirectChannel
                    ? t("directComposerPlaceholder", {
                        member: selectedChannelDisplayName,
                      })
                    : t("composerPlaceholderWithChannel", {
                        channel: selectedChannelDisplayName,
                      })
                }
                attachments={composerAttachments}
                onAttachmentsChange={setComposerAttachments}
                onSubmit={handleSend}
                isSending={isSending}
                sendDisabled={composerValue.trim().length === 0}
                showMentionShortcut={shouldShowRoomMentionShortcut(
                  selectedChannel,
                )}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="border-border/70 bg-muted/20 max-w-md rounded-md border border-dashed px-6 py-10 text-center">
                <Hash className="text-muted-foreground mx-auto size-8" />
                <h2 className="mt-4 text-lg font-semibold">
                  {t("Empty.noChannelTitle")}
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  {t("Empty.noChannelDescription")}
                </p>
                <div className="mt-5">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => router.push("/channels?create=channel")}
                  >
                    {t("createChannel")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
        {selectedChannel && threadParentMessage ? (
          <ThreadPanel
            parentMessage={threadParentMessage}
            replies={threadMessages}
            isLoading={isThreadLoading}
            coworkersById={coworkersById}
            coworkersBySlug={coworkersBySlug}
            mentionRecords={mentionRecords}
            replyValue={threadComposerValue}
            onReplyValueChange={setThreadComposerValue}
            replyMentionedCoworkerIdsChange={setThreadMentionedCoworkerIds}
            replyAttachments={threadComposerAttachments}
            onReplyAttachmentsChange={setThreadComposerAttachments}
            onSubmitReply={handleSendThreadReply}
            isSendingReply={isSendingThreadReply}
            onClose={() => setThreadParentMessage(null)}
            onToggleReaction={handleToggleReaction}
            showMentionShortcut={shouldShowRoomMentionShortcut(selectedChannel)}
          />
        ) : null}
      </main>
    </div>
  );
}
