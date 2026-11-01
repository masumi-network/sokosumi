"use client";

import type { ChatCatchUpSummary } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  ChatCaughtUp,
  ChatUnreadViewHeader,
} from "@/app/chat/components/chat-unread-view-header";
import { getChatCatchUpSummaryAction } from "@/app/chat/signal-actions";
import { isCatchUpSummaryEmpty } from "@/components/chat/signals/catch-up-summary-body";
import { useOtherWorkspaceRooms } from "@/components/chat/use-other-workspace-rooms";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  BriefingHeader,
  BriefingTopics,
  OpenLoopsList,
  QuietRooms,
} from "./catch-up-briefing";
import { CatchUpElsewhereRooms } from "./catch-up-elsewhere-rooms";

interface CatchUpViewProps {
  currentUserId: string;
  organizationId: string | null;
}

/**
 * The reader's "welcome back" across every room they have not muted, full
 * width: how long they were away, the gist and Mark all as read on top; then
 * what happened as topics, what waits on them first; on the side, what is
 * still open, rooms with nothing for them and their other workspaces.
 * Loaded in the browser, so the page paints at once and the written summary
 * arrives when the model has it.
 */
export function CatchUpView({
  currentUserId,
  organizationId,
}: CatchUpViewProps) {
  const t = useTranslations("App.Channels.Signals");
  const { rooms: elsewhereRooms, answered: elsewhereAnswered } =
    useOtherWorkspaceRooms({
      currentUserId,
      organizationId,
      enabled: true,
    });
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
  const reload = () => void refetch();
  const empty = data != null && isCatchUpSummaryEmpty(data);
  // Nothing written is not "caught up" until the list beside it has answered:
  // said sooner, the claim could stand over rooms still on their way.
  const showsSummary = data != null && (!empty || elsewhereAnswered);
  const elsewhere = (
    <CatchUpElsewhereRooms
      rooms={elsewhereRooms}
      currentUserId={currentUserId}
    />
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-4">
      <ChatUnreadViewHeader title={t("whileYouWereAwayTitle")} />
      {!showsSummary ? (
        <>
          <div className={HOLDER_CLASS}>
            <div className={cn(HOLDER_ITEM_CLASS, "p-4 md:p-5")}>
              {isError ? (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-muted-foreground text-sm">{t("error")}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={isFetching}
                    onClick={reload}
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
          </div>
          {elsewhere}
        </>
      ) : empty ? (
        elsewhereRooms.length > 0 ? (
          elsewhere
        ) : (
          <div className={HOLDER_CLASS}>
            <div className={HOLDER_ITEM_CLASS}>
              <ChatCaughtUp
                title={t("caughtUpTitle")}
                description={t("caughtUpDescription")}
              />
            </div>
          </div>
        )
      ) : (
        <>
          <div data-testid="catch-up-summary">
            <BriefingHeader summary={data} onChanged={reload} />
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
            <div className="flex min-w-0 flex-col gap-4">
              <BriefingTopics topics={data.topics} onChanged={reload} />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <OpenLoopsList items={data.openLoops} onChanged={reload} />
              <QuietRooms rooms={data.quietRooms} onChanged={reload} />
              {elsewhere}
              <p className="text-muted-foreground px-2 text-xs text-pretty">
                {t("aiNote")}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
