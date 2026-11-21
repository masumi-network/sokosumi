"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, MessageSquare, Sunrise } from "lucide-react";
import { useTranslations } from "next-intl";
import { loadChatComposeRosterAction } from "@/app/chat/actions";
import { ChatEmptyState } from "@/app/chat/components/chat-unread-view-header";
import { CreateChannelDialog } from "@/app/chat/components/create-channel-dialog";
import { CreateDirectDialog } from "@/app/chat/components/create-direct-dialog";
import { fetchSidebarRoomCollection } from "@/components/chat/fetch-sidebar-room-collection";
import { useOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";

const FIRST_STEPS_QUERY_KEY = "chat-catch-up-first-steps";

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
  const {
    hasOrganization,
    membersLoadFailed,
    people,
    peopleLoadFailed,
    currentUserId,
  } = roster.value;
  // A list that failed to load would open its dialog on an error, so its
  // action is not offered.
  return {
    // Channels belong to an organization, as in the sidebar.
    canCreateChannel: hasOrganization && !membersLoadFailed,
    hasTeammates:
      !peopleLoadFailed && people.some((person) => person.id !== currentUserId),
  };
}

interface CatchUpEmptyProps {
  currentUserId: string;
  organizationId: string | null;
}

/** Catch up with nothing unread: caught up, or for a new reader, where to start. */
export function CatchUpEmpty({
  currentUserId,
  organizationId,
}: CatchUpEmptyProps) {
  const t = useTranslations("App.Channels.Signals");
  const queryClient = useQueryClient();
  // A room created, joined or left (the dialogs and the control channel both
  // announce it) can end or bring back the first visit: ask again.
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: [FIRST_STEPS_QUERY_KEY],
    });
  };
  useOrganizationChatRoomsChanged({
    onRemoved: refresh,
    onRoom: refresh,
    onInvalidated: refresh,
  });
  const { data: firstSteps, isPending } = useQuery({
    // Per reader and workspace: rooms and channel rights differ by workspace.
    queryKey: [FIRST_STEPS_QUERY_KEY, currentUserId, organizationId],
    queryFn: loadFirstSteps,
    // A room made or joined elsewhere ends the first visit: read again on
    // every return instead of trusting the app's one-minute freshness.
    staleTime: 0,
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
          <ChatEmptyState
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
          </ChatEmptyState>
        ) : (
          <ChatEmptyState
            title={t("caughtUpTitle")}
            description={t("caughtUpDescription")}
          />
        )}
      </div>
    </div>
  );
}
