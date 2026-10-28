"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ChatCaughtUp } from "@/app/chat/components/chat-unread-view-header";
import {
  CatchUpSummaryBody,
  isCatchUpSummaryEmpty,
} from "@/components/chat/signals/catch-up-summary-body";
import { fetchRoomSummary } from "@/components/chat/signals/fetch-room-summary";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

interface RoomSummaryPopoverProps {
  roomId: string;
  onJump: (messageId: string) => Promise<boolean>;
}

/**
 * One room's written summary. Core answers from the reader's read state, so
 * it has to be asked while the room is still unread: asked once the room is
 * read, it comes back empty. The catch-up line therefore starts it on open,
 * over a background route so the model call cannot hold up marking the room
 * read behind it in the server action queue.
 */
export function useRoomSummary(roomId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["chat-room-summary", roomId],
    queryFn: () => fetchRoomSummary(roomId),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    // Kept for the visit only: the next visit has a different unread set.
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    // The popover mounts after the line started this; without it a failed
    // read would be silently asked again, a second model call.
    retryOnMount: false,
  });
}

/** One room's "while you were away", written, behind a quiet text button. */
export function RoomSummaryPopover({
  roomId,
  onJump,
}: RoomSummaryPopoverProps) {
  const t = useTranslations("App.Channels.Signals");
  const [open, setOpen] = useState(false);
  const { data, isError, isFetching, refetch } = useRoomSummary(roomId, true);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-foreground shrink-0 rounded-md px-1.5 py-0.5 text-sm font-medium hover:underline"
          data-testid="room-summary-trigger"
        >
          {t("summarize")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="max-h-[min(32rem,70dvh)] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto p-3"
      >
        {data ? (
          isCatchUpSummaryEmpty(data) ? (
            <ChatCaughtUp
              title={t("caughtUpTitle")}
              description={t("caughtUpDescription")}
            />
          ) : (
            <CatchUpSummaryBody
              summary={data}
              onJump={(messageId) => {
                setOpen(false);
                void onJump(messageId);
              }}
            />
          )
        ) : isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-muted-foreground text-sm">{t("error")}</p>
            <Button
              variant="secondary"
              size="sm"
              loading={isFetching}
              onClick={() => void refetch()}
            >
              {t("retry")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2" aria-busy>
            <span className="sr-only">{t("summarizing")}</span>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
