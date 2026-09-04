"use client";

import type { ChannelLinkTarget } from "@sokosumi/utils";
import { Pin, PinOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { listPinnedMessagesAction } from "@/app/chat/actions";
import { Button } from "@/components/ui/button";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomPinnedMessageListItem,
  ChatRoomSokoBotParticipant,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import type { ChatParticipantHoverProfile } from "./room-helpers";
import { messageSender } from "./room-helpers";
import { ChannelMessageText } from "./room-message-row";

export const PINNED_MESSAGES_PANEL_ID = "pinned-messages-panel";

export interface PinnedMessagesPanelLabels {
  title: string;
  close: string;
  empty: string;
  loading: string;
  error: string;
  couldNotLoad: string;
  unpin: string;
  loadOlder: string;
}

interface PinnedMessagesPanelProps {
  roomId: string;
  labels: PinnedMessagesPanelLabels;
  listGeneration: number;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  sokoBotsById?: Map<string, ChatRoomSokoBotParticipant>;
  sokoBotsBySlug?: Map<string, ChatRoomSokoBotParticipant>;
  usersById: Map<string, Pick<ChatRoomUserParticipant, "id" | "name">>;
  usersBySlug: Map<string, Pick<ChatRoomUserParticipant, "id" | "name">>;
  channelLinks: readonly ChannelLinkTarget[];
  currentUserId: string;
  canOpenHumanDirect: boolean;
  onOpenDirectMessage: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey: string | null;
  onClose: () => void;
  onJump: (messageId: string) => void;
  onUnpin: (messageId: string) => Promise<boolean>;
  onIdsLoaded: (messageIds: readonly string[]) => void;
}

export function PinnedMessagesHeaderButton({
  isOpen,
  onToggle,
  openLabel,
}: {
  isOpen: boolean;
  onToggle: () => void;
  openLabel: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={openLabel}
      aria-expanded={isOpen}
      data-testid="pinned-messages-trigger"
      className="size-8"
      onClick={onToggle}
    >
      <Pin className="size-4" />
    </Button>
  );
}

export function PinnedMessagesPanel({
  roomId,
  labels,
  listGeneration,
  coworkersById,
  coworkersBySlug,
  sokoBotsById,
  sokoBotsBySlug,
  usersById,
  usersBySlug,
  channelLinks,
  currentUserId,
  canOpenHumanDirect,
  onOpenDirectMessage,
  openingDirectParticipantKey,
  onClose,
  onJump,
  onUnpin,
  onIdsLoaded,
}: PinnedMessagesPanelProps) {
  const [items, setItems] = useState<ChatRoomPinnedMessageListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { formatTimeAgo } = useLocalizedDateTime();

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setNextCursor(null);
    void listPinnedMessagesAction(roomId)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setError(labels.error);
          setItems([]);
          setIsLoading(false);
          return;
        }
        setItems(result.value.items);
        setNextCursor(result.value.nextCursor);
        onIdsLoaded(result.value.items.map((item) => item.messageId));
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setError(labels.error);
        setItems([]);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [labels.error, listGeneration, onIdsLoaded, roomId]);

  return (
    <aside
      id={PINNED_MESSAGES_PANEL_ID}
      className="bg-background absolute inset-0 z-30 flex min-h-0 flex-col border-l lg:static lg:w-96 lg:shrink-0"
      data-testid="pinned-messages-panel"
    >
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Pin className="size-4 shrink-0" aria-hidden />
          <h2 className="truncate text-sm font-medium">{labels.title}</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={labels.close}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            {labels.loading}
          </p>
        ) : null}
        {error ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            {error}
          </p>
        ) : null}
        {!isLoading && !error && items.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            {labels.empty}
          </p>
        ) : null}
        {items.map((item) => {
          const message = item.message;
          const unpinControl = (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground size-8 shrink-0"
              aria-label={labels.unpin}
              onClick={() => {
                void (async () => {
                  const removed = await onUnpin(item.messageId);
                  if (!removed) {
                    return;
                  }
                  setItems((current) =>
                    current.filter((pin) => pin.messageId !== item.messageId),
                  );
                })();
              }}
            >
              <PinOff className="size-4" />
            </Button>
          );
          if (!message) {
            return (
              <div
                key={item.messageId}
                className="border-border mb-3 flex items-start gap-1 rounded-lg border p-3"
              >
                <p className="text-muted-foreground min-w-0 flex-1 text-sm">
                  {labels.couldNotLoad}
                </p>
                {unpinControl}
              </div>
            );
          }
          const sender = messageSender(message);
          return (
            <div
              key={item.messageId}
              className={cn(
                "border-border hover:bg-accent/40 mb-3 flex w-full items-start gap-1 rounded-lg border p-3 text-left",
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  onJump(item.messageId);
                }}
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-sm font-medium">
                    {sender.name}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {formatTimeAgo(new Date(message.createdAt))}
                  </span>
                </div>
                <div className="mt-1 line-clamp-6 text-sm">
                  <ChannelMessageText
                    content={message.content}
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
              </button>
              {unpinControl}
            </div>
          );
        })}
        {nextCursor ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={isLoadingOlder}
            onClick={() => {
              void (async () => {
                setIsLoadingOlder(true);
                try {
                  const result = await listPinnedMessagesAction(roomId, {
                    cursor: nextCursor,
                  });
                  if (!result.ok) {
                    setError(labels.error);
                    return;
                  }
                  setItems((current) => [...current, ...result.value.items]);
                  setNextCursor(result.value.nextCursor);
                  onIdsLoaded(result.value.items.map((item) => item.messageId));
                } catch {
                  setError(labels.error);
                } finally {
                  setIsLoadingOlder(false);
                }
              })();
            }}
          >
            {labels.loadOlder}
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
