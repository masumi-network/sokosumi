"use client";

import type { ChannelLinkTarget } from "@sokosumi/utils";
import { Loader2, Pin, PinOff, X } from "lucide-react";
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
  jumping: string;
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
  /** Resolves true once the message is on screen. */
  onJump: (messageId: string) => Promise<boolean>;
  onUnpin: (messageId: string) => Promise<boolean>;
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
}: PinnedMessagesPanelProps) {
  const [items, setItems] = useState<ChatRoomPinnedMessageListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jumpingMessageId, setJumpingMessageId] = useState<string | null>(null);
  const { formatTimeAgo } = useLocalizedDateTime();

  // The panel stays up while the window loads, with the tapped row marked, so
  // the tap is seen to do something. It closes only once the message is on
  // screen: on a phone it covers the transcript, and closing early would show
  // the reader the room standing still. A jump that gave up leaves the panel
  // open so the row is still there to tap again.
  async function handleJump(messageId: string) {
    setJumpingMessageId(messageId);
    try {
      if (await onJump(messageId)) {
        onClose();
      }
    } finally {
      setJumpingMessageId((current) =>
        current === messageId ? null : current,
      );
    }
  }

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
  }, [labels.error, listGeneration, roomId]);

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
              className="text-muted-foreground relative z-[1] size-8 shrink-0"
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
          const isJumping = jumpingMessageId === item.messageId;
          const quoteOnly =
            message.content.trim().length === 0 ? message.quote : null;
          const bodyId = `pinned-message-body-${item.messageId}`;
          // The body holds its own buttons, links and players, so it cannot
          // sit inside the jump button. The header is the button; its
          // ::after stretches over the row so a click anywhere jumps. The
          // body is layered above that and lets clicks through to it, except
          // on its own controls (the drive card's layering).
          return (
            <div
              key={item.messageId}
              className="border-border hover:bg-card-background relative mb-3 flex w-full items-start gap-1 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="flex w-full min-w-0 cursor-pointer items-baseline gap-2 text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
                  aria-busy={isJumping}
                  aria-describedby={bodyId}
                  onClick={() => {
                    void handleJump(item.messageId);
                  }}
                >
                  <span className="truncate text-sm font-medium">
                    {sender.name}
                  </span>
                  {isJumping ? (
                    <span className="text-muted-foreground flex shrink-0 items-center self-center">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      <span className="sr-only">{labels.jumping}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {formatTimeAgo(new Date(message.createdAt))}
                    </span>
                  )}
                </button>
                {/* A quote can be the whole message; show what was quoted. */}
                {quoteOnly ? (
                  <div className="text-foreground mt-1 truncate text-xs font-semibold">
                    {quoteOnly.authorName}
                  </div>
                ) : null}
                <div
                  id={bodyId}
                  data-testid="pinned-message-body"
                  className={cn(
                    "pointer-events-none relative z-[1] mt-1 line-clamp-6 text-sm [&_:is(a,button,audio,video,[role=button],[data-slot=hover-card-trigger])]:pointer-events-auto",
                    quoteOnly &&
                      "border-primary-tertiary text-muted-foreground border-l-2 pl-2.5",
                  )}
                >
                  <ChannelMessageText
                    content={quoteOnly ? quoteOnly.snippet : message.content}
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
              </div>
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
