"use client";

import type { ChatRoom, ChatSavedMessageListItem } from "@sokosumi/core-client";
import { Bookmark, BookmarkX } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  listSavedMessagesAction,
  unsaveRoomMessageAction,
} from "@/app/chat/actions";
import { ChatUnreadViewHeader } from "@/app/chat/components/chat-unread-view-header";
import { messageSender } from "@/app/chat/components/room-helpers";
import { useRoomDisplayName } from "@/app/chat/components/use-room-display-name";
import { roomMentionNames } from "@/app/chat/utils/room-mention-names";
import { formatUnreadThreadsPreview } from "@/app/chat/utils/unread-threads-preview";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

interface SavedMessagesViewProps {
  /** Core's first page at request time, or null when that read failed. */
  initialPage: {
    items: ChatSavedMessageListItem[];
    nextCursor: string | null;
  } | null;
  /** The sidebar's rooms, to name each message's room. */
  initialRooms: readonly ChatRoom[];
  currentUserId: string;
}

/**
 * Catch up's Saved tab: the messages the reader saved for later, newest save
 * first. Private to the reader; Core lists only messages they can still read.
 */
export function SavedMessagesView({
  initialPage,
  initialRooms,
  currentUserId,
}: SavedMessagesViewProps) {
  const t = useTranslations("App.Channels.SavedMessages");
  const tChannels = useTranslations("App.Channels");
  const roomDisplayName = useRoomDisplayName();
  const { formatTimeAgo } = useLocalizedDateTime();
  // As the Threads view does: once a live read has landed, null is that read
  // being dropped (a workspace switch), so the page's rooms must not return.
  const liveRooms = useLiveChatRooms();
  const sawLiveRooms = useRef(false);
  if (liveRooms !== null) {
    sawLiveRooms.current = true;
  }
  const rooms = liveRooms ?? (sawLiveRooms.current ? [] : initialRooms);
  const roomsById = new Map(rooms.map((room) => [room.id, room]));

  // A new first page from the server (workspace switch, refresh) replaces
  // the list and its cursor; nothing from the old scope stays.
  const [page, setPage] = useState(initialPage);
  const [items, setItems] = useState(initialPage?.items ?? []);
  const [nextCursor, setNextCursor] = useState(initialPage?.nextCursor ?? null);
  if (page !== initialPage) {
    setPage(initialPage);
    setItems(initialPage?.items ?? []);
    setNextCursor(initialPage?.nextCursor ?? null);
  }
  const currentPage = useRef(initialPage);
  useEffect(() => {
    currentPage.current = initialPage;
  }, [initialPage]);

  const [loadingOlder, setLoadingOlder] = useState(false);
  // Saves with an unsave on its way to Core. They are off the list at once
  // and return, in place, when the write fails.
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  // Live rooms are the reader's access now: a row whose room left the
  // sidebar (membership lost) goes at once, before Core is asked again.
  const visibleItems = items.filter(
    (item) =>
      !removing.has(item.messageId) &&
      (!sawLiveRooms.current || roomsById.has(item.message.roomId)),
  );

  async function handleRemove(messageId: string) {
    setRemoving((current) => new Set(current).add(messageId));
    // A rejected call is a failed write too: the row must not stay off the
    // list when Core never removed the save.
    const result = await unsaveRoomMessageAction(messageId).catch(() => null);
    if (result?.ok) {
      setItems((current) =>
        current.filter((item) => item.messageId !== messageId),
      );
      toast.success(t("removed"));
    } else {
      toast.error(result?.error.message ?? t("removeError"));
    }
    setRemoving((current) => {
      const next = new Set(current);
      next.delete(messageId);
      return next;
    });
  }

  async function handleLoadOlder() {
    if (!nextCursor) return;
    const startedOn = initialPage;
    setLoadingOlder(true);
    const result = await listSavedMessagesAction(nextCursor);
    setLoadingOlder(false);
    // The scope changed while this page was out: it belongs to the old list.
    if (currentPage.current !== startedOn) return;
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setItems((current) => [...current, ...result.value.items]);
    setNextCursor(result.value.nextCursor);
  }

  return (
    <div className="flex w-full flex-col gap-4 pb-4">
      <div className="flex flex-col gap-1">
        <ChatUnreadViewHeader title={t("title")} />
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <div className={cn(HOLDER_CLASS, "flex flex-col gap-2")}>
        <div className={cn(HOLDER_ITEM_CLASS, "flex flex-col p-2")}>
          {initialPage === null ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              {t("error")}
            </p>
          ) : visibleItems.length === 0 ? (
            <div
              className="flex flex-col items-center gap-1.5 px-4 py-6 text-center"
              data-testid="saved-messages-empty"
            >
              <span className="bg-quinary text-foreground grid size-8 place-items-center rounded-full">
                <Bookmark className="size-4" aria-hidden />
              </span>
              <p className="text-sm font-medium">{t("empty")}</p>
              <p className="text-muted-foreground max-w-xs text-sm text-pretty">
                {t("emptyHint")}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5" data-testid="saved-messages">
              {visibleItems.map(({ messageId, savedAt, message }) => {
                const room = roomsById.get(message.roomId);
                const roomName = room
                  ? room.kind === "channel"
                    ? `#${roomDisplayName(room, currentUserId)}`
                    : roomDisplayName(room, currentUserId)
                  : null;
                const preview =
                  formatUnreadThreadsPreview(
                    message.content,
                    roomMentionNames(room, tChannels("MentionAll.label")),
                  ) || t("untitled");
                return (
                  <li
                    key={messageId}
                    className="press hover:bg-accent relative flex items-start gap-2 rounded-md px-2 py-2 transition-colors"
                  >
                    <Link
                      href={chatRoomMessageHref(message.roomId, messageId)}
                      className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="truncate font-medium">
                          {messageSender(message).name}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {formatTimeAgo(new Date(message.createdAt))}
                        </span>
                      </span>
                      <span className="text-foreground line-clamp-3">
                        {preview}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {roomName ? (
                          <>
                            {roomName}
                            <span aria-hidden="true"> · </span>
                          </>
                        ) : null}
                        {t("savedAgo", {
                          time: formatTimeAgo(new Date(savedAt)),
                        })}
                      </span>
                    </Link>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground relative z-[1] size-10 shrink-0 md:size-8"
                      aria-label={t("remove")}
                      title={t("remove")}
                      onClick={(event) => {
                        // The rows below move up when this one leaves. The
                        // second click of a double-click would land on the
                        // next row's button and remove that save too.
                        if (event.detail > 1) return;
                        void handleRemove(messageId);
                      }}
                    >
                      <BookmarkX className="size-4" aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {nextCursor ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              loading={loadingOlder}
              onClick={() => void handleLoadOlder()}
            >
              {t("loadOlder")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
