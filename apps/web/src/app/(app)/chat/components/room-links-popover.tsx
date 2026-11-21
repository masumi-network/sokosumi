"use client";

import type { ChatRoomMessage } from "@sokosumi/core-client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link2, MessageSquareText } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import {
  RoomHeaderPopover,
  type RoomHeaderPopoverAnchor,
} from "@/components/chat/room-header-popover";
import { chatMessageSenderName } from "@/components/chat/signals/signal-chips";
import { Button } from "@/components/ui/button";
import { POPOVER_ROW_CLASS } from "@/components/ui/popover-row-classes";
import { Skeleton } from "@/components/ui/skeleton";
import { coreClient } from "@/lib/clients/core.browser.client";
import { cn } from "@/lib/utils";
import { linkLabel, roomLinks } from "./room-links";

/** Messages per page; each page is one Core room search. */
const PAGE_SIZE = 30;

interface RoomLinksPopoverProps {
  roomId: string;
  onJumpToMessage: (message: ChatRoomMessage) => void;
  anchor?: RoomHeaderPopoverAnchor;
}

/**
 * The web links posted in a room, newest first, thread replies included.
 * Core's room search finds the messages, so only members see them, and Load
 * older walks back through the whole history.
 */
export function RoomLinksPopover({
  roomId,
  onJumpToMessage,
  anchor,
}: RoomLinksPopoverProps) {
  const t = useTranslations("App.Channels.Links");

  return (
    <RoomHeaderPopover
      label={t("open")}
      title={t("title")}
      icon={<Link2 className="size-4" />}
      testId="room-links"
      anchor={anchor}
      footer={t("note")}
    >
      {(close) => (
        <LinksList
          roomId={roomId}
          onJump={(message) => {
            close();
            onJumpToMessage(message);
          }}
        />
      )}
    </RoomHeaderPopover>
  );
}

function LinksList({
  roomId,
  onJump,
}: {
  roomId: string;
  onJump: (message: ChatRoomMessage) => void;
}) {
  const t = useTranslations("App.Channels.Links");
  const format = useFormatter();
  const query = useInfiniteQuery({
    queryKey: ["chat-room-links", roomId],
    queryFn: async ({ pageParam }) => {
      const response = await coreClient.getChatRoomMessages(roomId, {
        q: "http",
        limit: PAGE_SIZE,
        cursor: pageParam,
      });
      return {
        links: roomLinks(response.data),
        nextCursor: response.meta?.pagination?.nextCursor ?? undefined,
      };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    // The list mounts on open and drops its cache on close, so every open
    // shows the links as they are now, edits and deletes included.
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const links = query.data?.pages.flatMap((page) => page.links) ?? [];

  return (
    <>
      {query.isPending ? (
        <div className="flex flex-col gap-2 px-2 pb-2" aria-busy>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : query.isError && !query.isFetchNextPageError ? (
        <div className="flex flex-col items-start gap-1 px-2 pb-2">
          <p className="text-muted-foreground text-sm">{t("error")}</p>
          <Button
            variant="outline"
            size="sm"
            loading={query.isRefetching}
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : links.length === 0 ? (
        <p className="text-muted-foreground px-2 pb-2 text-sm text-pretty">
          {query.hasNextPage ? t("emptyRecent") : t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col">
          {links.map(({ url, message }) => {
            const { host, path } = linkLabel(url);
            // The browser client hands back JSON, so this is a string at runtime.
            const sentAt = new Date(message.createdAt);
            return (
              <li
                key={`${message.id}-${url}`}
                className="flex items-center gap-1"
              >
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    POPOVER_ROW_CLASS,
                    "flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5",
                  )}
                >
                  <span className="truncate text-sm">
                    <span className="font-medium">{host}</span>
                    <span className="text-muted-foreground">{path}</span>
                  </span>
                  <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <span className="truncate">
                      {chatMessageSenderName(message)}
                    </span>
                    <span aria-hidden>·</span>
                    <time dateTime={sentAt.toISOString()}>
                      {format.dateTime(sentAt, {
                        day: "numeric",
                        month: "short",
                      })}
                    </time>
                  </span>
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10 shrink-0 md:size-8"
                  aria-label={t("showInChat", { host })}
                  title={t("showInChat", { host })}
                  onClick={() => onJump(message)}
                >
                  <MessageSquareText className="size-4" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {query.isFetchNextPageError ? (
        <p className="text-muted-foreground px-2 pt-1 text-sm" role="alert">
          {t("error")}
        </p>
      ) : null}
      {query.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("loadOlder")}
        </Button>
      ) : null}
    </>
  );
}
