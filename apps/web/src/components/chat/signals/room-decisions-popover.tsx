"use client";

import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { buildChatMessagePreview } from "@sokosumi/utils";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Gavel } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo } from "react";
import { listChatRoomDecisionsAction } from "@/app/chat/signal-actions";
import {
  RoomHeaderPopover,
  type RoomHeaderPopoverAnchor,
} from "@/components/chat/room-header-popover";
import { chatMessageSenderName } from "@/components/chat/signals/signal-chips";
import { Button } from "@/components/ui/button";
import { POPOVER_ROW_CLASS } from "@/components/ui/popover-row-classes";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface RoomDecisionsPopoverProps {
  room: ChatRoom;
  onJumpToMessage: (message: ChatRoomMessage) => void;
  anchor?: RoomHeaderPopoverAnchor;
}

/**
 * A channel's decision log: every message Jev read as a decision made,
 * newest first, with readers' corrections applied. Each entry jumps to its
 * message. The list mounts only while open, so a closed header costs nothing.
 */
export function RoomDecisionsPopover({
  room,
  onJumpToMessage,
  anchor,
}: RoomDecisionsPopoverProps) {
  const t = useTranslations("App.Channels.Signals");

  return (
    <RoomHeaderPopover
      label={t("Decisions.open")}
      title={t("Decisions.title")}
      icon={<Gavel className="size-4" />}
      testId="room-decisions"
      anchor={anchor}
      footer={t("Decisions.note")}
    >
      {(close) => (
        <DecisionsList
          room={room}
          onJump={(message) => {
            close();
            onJumpToMessage(message);
          }}
        />
      )}
    </RoomHeaderPopover>
  );
}

function DecisionsList({
  room,
  onJump,
}: {
  room: ChatRoom;
  onJump: (message: ChatRoomMessage) => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  const names = useMemo(
    () => new Map(room.userMembers.map((member) => [member.id, member.name])),
    [room.userMembers],
  );
  const query = useInfiniteQuery({
    queryKey: ["chat-room-decisions", room.id],
    queryFn: async ({ pageParam }) => {
      const result = await listChatRoomDecisionsAction(room.id, pageParam);
      if (!result.ok) throw new Error(result.error.message ?? "");
      return result.value;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const decisions = query.data?.pages.flatMap((page) => page.messages) ?? [];

  return (
    <>
      {query.isPending ? (
        <div className="flex flex-col gap-2 px-2 pb-2" aria-busy>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : query.isError ? (
        <p className="text-muted-foreground px-2 pb-2 text-sm">{t("error")}</p>
      ) : decisions.length === 0 ? (
        <p className="text-muted-foreground px-2 pb-2 text-sm text-pretty">
          {t("Decisions.empty")}
        </p>
      ) : (
        <ul className="flex flex-col">
          {decisions.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                className={cn(
                  POPOVER_ROW_CLASS,
                  "flex w-full flex-col gap-0.5 px-2 py-1.5 text-start",
                )}
                onClick={() => onJump(message)}
              >
                <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <span className="truncate">
                    {chatMessageSenderName(message)}
                  </span>
                  <span aria-hidden>·</span>
                  <time dateTime={message.createdAt.toISOString()}>
                    {format.dateTime(message.createdAt, {
                      day: "numeric",
                      month: "short",
                    })}
                  </time>
                </span>
                <span className="line-clamp-3 text-sm text-pretty">
                  {buildChatMessagePreview(message.content, names)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("Decisions.loadOlder")}
        </Button>
      ) : null}
    </>
  );
}
