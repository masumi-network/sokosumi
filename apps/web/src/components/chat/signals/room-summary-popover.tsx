"use client";

import type { ChatCatchUpSummary } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { getChatCatchUpSummaryAction } from "@/app/chat/signal-actions";
import { CatchUpSummaryBody } from "@/components/chat/signals/catch-up-summary-body";
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

/** One room's "while you were away", written, behind a quiet text button. */
export function RoomSummaryPopover({
  roomId,
  onJump,
}: RoomSummaryPopoverProps) {
  const t = useTranslations("App.Channels.Signals");
  const [open, setOpen] = useState(false);
  const { data, isError } = useQuery({
    queryKey: ["chat-room-summary", roomId],
    queryFn: async (): Promise<ChatCatchUpSummary | null> => {
      const result = await getChatCatchUpSummaryAction(roomId);
      if (!result.ok) throw new Error(result.error.message ?? "");
      return result.value;
    },
    enabled: open,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-primary-variant shrink-0 rounded-md px-1.5 py-0.5 text-sm font-medium hover:underline"
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
          <CatchUpSummaryBody
            summary={data}
            onJump={(messageId) => {
              setOpen(false);
              void onJump(messageId);
            }}
          />
        ) : isError ? (
          <p className="text-muted-foreground text-sm">{t("error")}</p>
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
