"use client";

import type { ChatCatchUpSummary } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  ChatCaughtUp,
  ChatUnreadViewHeader,
} from "@/app/chat/components/chat-unread-view-header";
import { getChatCatchUpSummaryAction } from "@/app/chat/signal-actions";
import { CatchUpSummaryBody } from "@/components/chat/signals/catch-up-summary-body";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The reader's "while you were away" across every room they have not muted:
 * what waits on them first, then decisions, open loops and highlights, with
 * one written line per busy room. Loaded in the browser, so the page paints
 * at once and the written summary arrives when the model has it.
 */
export function CatchUpView() {
  const t = useTranslations("App.Channels.Signals");
  const { data, isError, refetch, isFetching } = useQuery({
    queryKey: ["chat-catch-up-summary"],
    queryFn: async (): Promise<ChatCatchUpSummary> => {
      const result = await getChatCatchUpSummaryAction();
      if (!result.ok) throw new Error(result.error.message ?? "");
      return result.value;
    },
    refetchOnWindowFocus: false,
    retry: false,
  });
  const empty =
    data != null &&
    data.headline == null &&
    data.needsYou.length === 0 &&
    data.decisions.length === 0 &&
    data.openLoops.length === 0 &&
    data.highlights.length === 0;

  return (
    <div className="flex w-full flex-col gap-4 pb-4">
      <ChatUnreadViewHeader title={t("whileYouWereAwayTitle")} />
      <div className={HOLDER_CLASS}>
        <div className={cn(HOLDER_ITEM_CLASS, "p-4 md:p-5")}>
          {data ? (
            empty ? (
              <ChatCaughtUp
                title={t("caughtUpTitle")}
                description={t("caughtUpDescription")}
              />
            ) : (
              <CatchUpSummaryBody summary={data} showRooms />
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
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="mt-4 h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}
        </div>
        <p className="text-muted-foreground px-2 pt-2 text-xs text-pretty">
          {t("aiNote")}
        </p>
      </div>
    </div>
  );
}
