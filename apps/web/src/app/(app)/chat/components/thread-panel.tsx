"use client";

import { Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
} from "@/lib/clients/generated/core";
import { RoomComposer, type RoomComposerAttachment } from "./room-composer";
import { ChatMessageRow } from "./room-message-row";

export function ThreadPanel({
  parentMessage,
  replies,
  isLoading,
  olderNextCursor,
  isLoadingOlder,
  onLoadOlder,
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
  allowAttachments = true,
}: {
  parentMessage: ChatRoomMessage;
  replies: ChatRoomMessage[];
  isLoading: boolean;
  olderNextCursor: string | null;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  mentionRecords: Record<
    string,
    MentionRecordEntry<ChatRoomCoworkerParticipant>
  >;
  replyValue: string;
  onReplyValueChange: Dispatch<SetStateAction<string>>;
  replyMentionedCoworkerIdsChange: (selectedKeys: string[]) => void;
  replyAttachments: RoomComposerAttachment[];
  onReplyAttachmentsChange: Dispatch<SetStateAction<RoomComposerAttachment[]>>;
  onSubmitReply: (event: FormEvent<HTMLFormElement>) => void;
  isSendingReply: boolean;
  onClose: () => void;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  showMentionShortcut?: boolean;
  allowAttachments?: boolean;
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
          ) : (
            <>
              {olderNextCursor ? (
                <div className="mb-3 flex justify-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isLoadingOlder}
                    onClick={onLoadOlder}
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
              {replies.length > 0 ? (
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
            </>
          )}
        </div>
      </ScrollArea>
      <RoomComposer
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
        allowAttachments={allowAttachments}
      />
    </aside>
  );
}
