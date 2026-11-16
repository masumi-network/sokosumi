"use client";

import { useQuery } from "@tanstack/react-query";
import { Hash, MessageSquare, Sunrise } from "lucide-react";
import { useTranslations } from "next-intl";
import { loadChatComposeRosterAction } from "@/app/chat/actions";
import { ChatCaughtUp } from "@/app/chat/components/chat-unread-view-header";
import { CreateChannelDialog } from "@/app/chat/components/create-channel-dialog";
import { CreateDirectDialog } from "@/app/chat/components/create-direct-dialog";
import { fetchSidebarRoomCollection } from "@/components/chat/fetch-sidebar-room-collection";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";

interface FirstSteps {
  canCreateChannel: boolean;
  hasTeammates: boolean;
}

/**
 * First steps for a reader with no room in this workspace, or null when they
 * have one (or the rooms could not be read): then they are simply caught up.
 * The roster is a server action, so only a reader with no room asks for it.
 */
async function loadFirstSteps(): Promise<FirstSteps | null> {
  const page = await fetchSidebarRoomCollection("active");
  if (!page || page.rooms.length > 0) {
    return null;
  }
  const roster = await loadChatComposeRosterAction();
  if (!roster.ok) {
    return { canCreateChannel: false, hasTeammates: false };
  }
  const { hasOrganization, people, currentUserId } = roster.value;
  return {
    // Channels belong to an organization, as in the sidebar.
    canCreateChannel: hasOrganization,
    hasTeammates: people.some((person) => person.id !== currentUserId),
  };
}

/** Catch up with nothing unread: caught up, or for a new reader, where to start. */
export function CatchUpEmpty() {
  const t = useTranslations("App.Channels.Signals");
  const { data: firstSteps, isPending } = useQuery({
    queryKey: ["chat-catch-up-first-steps"],
    queryFn: loadFirstSteps,
    refetchOnWindowFocus: false,
    retry: false,
  });

  return (
    <div className={HOLDER_CLASS}>
      <div className={HOLDER_ITEM_CLASS}>
        {isPending ? (
          <div className="flex flex-col items-center gap-2 px-4 py-6" aria-busy>
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-64 max-w-full" />
          </div>
        ) : firstSteps ? (
          <ChatCaughtUp
            icon={Sunrise}
            title={t("firstCatchUpTitle")}
            description={t("firstCatchUpDescription")}
          >
            {firstSteps.canCreateChannel || firstSteps.hasTeammates ? (
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {firstSteps.canCreateChannel ? (
                  <CreateChannelDialog
                    trigger={
                      <Button type="button" variant="primary" size="sm">
                        <Hash aria-hidden />
                        {t("firstCatchUpCreateChannel")}
                      </Button>
                    }
                  />
                ) : null}
                {firstSteps.hasTeammates ? (
                  <CreateDirectDialog
                    trigger={
                      <Button type="button" variant="secondary" size="sm">
                        <MessageSquare aria-hidden />
                        {t("firstCatchUpMessageTeammate")}
                      </Button>
                    }
                  />
                ) : null}
              </div>
            ) : null}
          </ChatCaughtUp>
        ) : (
          <ChatCaughtUp
            title={t("caughtUpTitle")}
            description={t("caughtUpDescription")}
          />
        )}
      </div>
    </div>
  );
}
