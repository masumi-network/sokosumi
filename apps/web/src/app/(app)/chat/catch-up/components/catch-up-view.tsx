"use client";

import type { ChatCatchUpSummary } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { markAllChatUnreadReadAction } from "@/app/chat/actions";
import {
  ChatCaughtUp,
  ChatUnreadViewHeader,
} from "@/app/chat/components/chat-unread-view-header";
import { getChatCatchUpSummaryAction } from "@/app/chat/signal-actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import {
  CatchUpSummaryBody,
  isCatchUpSummaryEmpty,
} from "@/components/chat/signals/catch-up-summary-body";
import { useOtherWorkspaceRooms } from "@/components/chat/use-other-workspace-rooms";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CatchUpElsewhereRooms } from "./catch-up-elsewhere-rooms";

interface CatchUpViewProps {
  currentUserId: string;
  organizationId: string | null;
}

/**
 * The reader's "while you were away" across every room they have not muted:
 * what waits on them first, then blockers, decisions, announcements, open
 * loops and a few highlights. Loaded in the browser, so the page paints at
 * once and the written summary arrives when the model has it. Below it, the
 * unread rooms of the reader's other workspaces, which ask nothing of the
 * model and so paint whatever the summary does.
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
  const empty = data != null && isCatchUpSummaryEmpty(data);
  // Nothing written is not "caught up" until the list above has answered: said
  // sooner, the claim could stand over rooms still on their way.
  const showsSummary = data != null && (!empty || elsewhereAnswered);

  return (
    <div className="flex w-full max-w-3xl min-w-0 flex-col gap-4 pb-4">
      <ChatUnreadViewHeader title={t("whileYouWereAwayTitle")} />
      {empty && elsewhereRooms.length > 0 ? null : (
        <div className={HOLDER_CLASS}>
          <div className={cn(HOLDER_ITEM_CLASS, "p-4 md:p-5")}>
            {showsSummary ? (
              empty ? (
                <ChatCaughtUp
                  title={t("caughtUpTitle")}
                  description={t("caughtUpDescription")}
                />
              ) : (
                <>
                  <CatchUpSummaryBody
                    summary={data}
                    onHandled={() => void refetch()}
                  />
                  <MarkAllRead summary={data} onDone={() => void refetch()} />
                </>
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
      )}
      <CatchUpElsewhereRooms
        rooms={elsewhereRooms}
        currentUserId={currentUserId}
      />
    </div>
  );
}

/**
 * Reads every room the listed messages came from: a message in a Thread
 * reads that room's Threads, one in the room reads the room.
 */
function MarkAllRead({
  summary,
  onDone,
}: {
  summary: ChatCatchUpSummary;
  onDone: () => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const [isMarking, startMarking] = useTransition();
  const rooms = new Map<string, { readRoom: boolean; lookThreads: boolean }>();
  for (const item of [
    ...summary.needsYou,
    ...summary.blockers,
    ...summary.decisions,
    ...summary.announcements,
    ...summary.highlights,
  ]) {
    const room = rooms.get(item.roomId) ?? {
      readRoom: false,
      lookThreads: false,
    };
    if (item.parentMessageId) room.lookThreads = true;
    else room.readRoom = true;
    rooms.set(item.roomId, room);
  }
  if (rooms.size === 0) return null;

  return (
    <div className="border-border mt-6 flex justify-end border-t pt-4">
      <Button
        variant="secondary"
        size="sm"
        loading={isMarking}
        onClick={() =>
          startMarking(async () => {
            const result = await markAllChatUnreadReadAction(
              [...rooms].map(([roomId, reads]) => ({ roomId, ...reads })),
            );
            if (!result.ok) toast.error(t("markAllReadError"));
            notifyOrganizationChatRoomsChanged({ collections: ["active"] });
            onDone();
          })
        }
      >
        <CheckCheck aria-hidden />
        {t("markAllRead")}
      </Button>
    </div>
  );
}
