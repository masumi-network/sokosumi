"use client";

import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { Gavel } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChatEmptyState,
  ChatUnreadViewHeader,
} from "@/app/chat/components/chat-unread-view-header";
import { messageSender } from "@/app/chat/components/room-helpers";
import { useRoomDisplayName } from "@/app/chat/components/use-room-display-name";
import {
  correctChatSignalTagAction,
  listChatDecisionsAction,
} from "@/app/chat/signal-actions";
import { roomMentionNames } from "@/app/chat/utils/room-mention-names";
import { formatUnreadThreadsPreview } from "@/app/chat/utils/unread-threads-preview";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";
import {
  usePageListSearch,
  usePageSearchPagination,
} from "@/components/page-list-search";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { useLatestRef } from "@/hooks/effects/use-latest-ref";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

interface DecisionsViewProps {
  /** Core's first page at request time, or null when that read failed. */
  initialPage: {
    messages: ChatRoomMessage[];
    nextCursor: string | null;
  } | null;
  /** The sidebar's rooms, to name each message's room. */
  initialRooms: readonly ChatRoom[];
  currentUserId: string;
}

/**
 * Catch up's Decisions tab: every decision Jev found in the reader's rooms,
 * read or not, newest first. Each opens its message, in its Thread if a reply.
 */
export function DecisionsView({
  initialPage,
  initialRooms,
  currentUserId,
}: DecisionsViewProps) {
  const t = useTranslations("App.Channels.Signals.Decisions");
  const tChannels = useTranslations("App.Channels");
  const roomDisplayName = useRoomDisplayName();
  const { formatTimeAgo } = useLocalizedDateTime();
  // As the Saved view does: once a live read has landed, null is that read
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
  const [messages, setMessages] = useState(initialPage?.messages ?? []);
  const [nextCursor, setNextCursor] = useState(initialPage?.nextCursor ?? null);
  if (page !== initialPage) {
    setPage(initialPage);
    setMessages(initialPage?.messages ?? []);
    setNextCursor(initialPage?.nextCursor ?? null);
  }
  const currentPage = useLatestRef(initialPage);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  // Live rooms are the reader's access now: a decision whose room left the
  // sidebar (membership lost) goes at once, before Core is asked again.
  const visible = sawLiveRooms.current
    ? messages.filter((message) => roomsById.has(message.roomId))
    : messages;

  const matching = usePageListSearch(visible, (message) => {
    const room = roomsById.get(message.roomId);
    return {
      primary: [
        formatUnreadThreadsPreview(
          message.content,
          roomMentionNames(room, tChannels("MentionAll.label")),
        ),
      ],
      secondary: [
        messageSender(message).name,
        room && roomDisplayName(room, currentUserId),
      ],
    };
  });

  usePageSearchPagination(nextCursor, loadingOlder, handleLoadOlder);

  // Removes only the Decision tag; the message keeps its other tags. Core
  // lets any member of the room correct a tag, the same as the room's chip.
  async function handleNotDecision(messageId: string, row: HTMLElement | null) {
    setRemoving((current) => new Set(current).add(messageId));
    let result: Awaited<ReturnType<typeof correctChatSignalTagAction>>;
    try {
      result = await correctChatSignalTagAction(
        messageId,
        "decisionMade",
        false,
      );
    } catch {
      toast.error(t("notDecisionError"));
      return;
    } finally {
      setRemoving((current) => {
        const next = new Set(current);
        next.delete(messageId);
        return next;
      });
    }
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    const updated = result.value;
    // Another reader may have put the tag back before Core answered.
    if (updated.signal?.tags.includes("decisionMade")) {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? updated : message,
        ),
      );
      return;
    }
    if (row?.contains(document.activeElement)) {
      focusAfterRemoval(row, rootRef.current);
    }
    setMessages((current) =>
      current.filter((message) => message.id !== messageId),
    );
  }

  async function handleLoadOlder() {
    if (!nextCursor) return;
    const startedOn = initialPage;
    setLoadingOlder(true);
    const result = await listChatDecisionsAction(nextCursor);
    setLoadingOlder(false);
    // The scope changed while this page was out: it belongs to the old list.
    if (currentPage.current !== startedOn) return;
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setMessages((current) => [...current, ...result.value.messages]);
    setNextCursor(result.value.nextCursor);
  }

  return (
    <div ref={rootRef} className="flex w-full flex-col gap-4 pb-4">
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
          ) : visible.length === 0 ? (
            <ChatEmptyState
              icon={Gavel}
              title={t("emptyTitle")}
              description={t("emptyHint")}
              testId="decisions-empty"
            />
          ) : (
            <ul className="flex flex-col gap-0.5" data-testid="decisions">
              {matching.map((message) => {
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
                    key={message.id}
                    className="press hover:bg-accent relative flex flex-wrap items-start gap-2 rounded-md px-2 py-2 transition-colors"
                  >
                    <Link
                      href={chatRoomMessageHref(message.roomId, message.id)}
                      className="flex min-w-0 flex-1 basis-full flex-col gap-0.5 text-sm outline-none sm:basis-0 after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring"
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
                      {roomName || message.parentMessageId ? (
                        <span className="text-muted-foreground truncate text-xs">
                          {[roomName, message.parentMessageId && t("inThread")]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </Link>
                    {room ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="relative ms-auto self-end"
                        loading={removing.has(message.id)}
                        aria-label={t("notDecisionFor", { message: preview })}
                        onClick={(event) =>
                          void handleNotDecision(
                            message.id,
                            event.currentTarget.closest("li"),
                          )
                        }
                      >
                        {t("notDecision")}
                      </Button>
                    ) : null}
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
      {visible.length > 0 ? (
        <p className="text-muted-foreground px-1 text-xs">{t("note")}</p>
      ) : null}
    </div>
  );
}

/**
 * A removed row took the focused button with it: focus the next row, else
 * the previous one, else the page heading.
 */
function focusAfterRemoval(row: HTMLElement, root: HTMLElement | null) {
  const sibling = row.nextElementSibling ?? row.previousElementSibling;
  const link = sibling?.querySelector("a");
  if (link) {
    link.focus();
    return;
  }
  const heading = root?.querySelector("h1");
  heading?.setAttribute("tabindex", "-1");
  heading?.focus();
}
