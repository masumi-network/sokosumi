import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { ChatLandingNotice } from "@/app/chat/components/chat-landing-notice";
import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import {
  getPrivateCachedChatListArchivedAndMembers,
  getPrivateCachedMembershipVisibleRooms,
} from "@/app/components/private-sidebar-cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/auth.server";
import { userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";
import { ChatMobileRoomList } from "./components/chat-mobile-room-list";
import { ChatLanding } from "./components/landing/chat-landing";
import { ChatLandingMobile } from "./components/landing/chat-landing.mobile";
import { RoomsClient } from "./components/rooms-client";
import { loadOrganizationMembers } from "./load-organization-members";
import { firstSearchValue } from "./load-room-messages";
import { resolveChatRootMobileSurface } from "./utils/chat-root-mobile-surface";

interface ChatPageProps {
  searchParams: Promise<{
    create?: string | string[];
    dm?: string | string[];
    notice?: string | string[];
  }>;
}

/**
 * Chat root (`/chat`): desktop is always Chat landing + sidebar. Mobile is
 * Chat landing when there are no membership-visible (and no archived) rooms,
 * otherwise the room list. The Chat tab and post-login path share this root.
 *
 * Draft modes via query: `?create=channel`, `?dm=new`.
 * Open rooms: `/chat/rooms/[roomId]`.
 *
 * Instant Nav uses `chat/loading.tsx` (landing-shaped) while this page streams
 * after `connection()`. Room open uses `rooms/[roomId]/loading.tsx`.
 */
export default async function ChatPage({ searchParams }: ChatPageProps) {
  // Defer before any cookies()/headers()-bound work so PPR shell probing does
  // not soft-reject dynamic APIs on this dynamic page.
  await connection();

  // Ordinary landing only needs session + coworkers. Draft create/DM paths
  // load org context and channel copy below so the Instant-streamed landing
  // stays light (heavy work only when draft query modes are active).
  const [query, session] = await Promise.all([searchParams, getSession()]);

  const isCreateChannelRequested = firstSearchValue(query.create) === "channel";
  const isNewDirectMessage = firstSearchValue(query.dm) === "new";
  const notice = firstSearchValue(query.notice);
  const landingNotice = <ChatLandingNotice notice={notice} />;

  if (isCreateChannelRequested || isNewDirectMessage) {
    const [tChannels, activeOrganization] = await Promise.all([
      getTranslations("App.Channels"),
      userService.getActiveOrganization(),
    ]);

    // Channels / create stay org-only. Start New DM (`?dm=new`) also works in
    // personal workspace: same DraftDirectMessage UI with empty members so the
    // picker is coworkers-only (solo coworker sends via room ensure).
    if (!activeOrganization) {
      if (!isNewDirectMessage) {
        return (
          <>
            {landingNotice}
            <div className="min-h-full w-full px-4 py-6">
              <div className="mx-auto max-w-3xl">
                <Card>
                  <CardHeader>
                    <CardTitle>{tChannels("NoOrganization.title")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">
                      {tChannels("NoOrganization.description")}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        );
      }

      const coworkers = await coworkerService.listCoworkers("chat");

      return (
        <>
          {landingNotice}
          <RoomsClient
            activeOrganization={null}
            rooms={[]}
            organizationMembers={[]}
            currentUserId={session?.user.id ?? ""}
            coworkers={coworkers}
            selectedRoomId={null}
            isCreateChannelRequested={false}
            isNewDirectMessage
            messageLoadFailed={false}
            membersLoadFailed={false}
            messages={[]}
            messagesNextCursor={null}
          />
        </>
      );
    }

    // Create/DM drafts do not need a rooms list — RoomsClient only looks up
    // selectedRoom by id, and sidebar already owns paginated room history.
    const [membersPage, coworkers, currentMember] = await Promise.all([
      loadOrganizationMembers(activeOrganization.id),
      coworkerService.listCoworkers("chat"),
      userService.getMyMemberInOrganization(activeOrganization.id),
    ]);

    return (
      <>
        {landingNotice}
        <RoomsClient
          activeOrganization={activeOrganization}
          rooms={[]}
          organizationMembers={membersPage.members}
          currentUserId={currentMember?.userId ?? ""}
          coworkers={coworkers}
          selectedRoomId={null}
          isCreateChannelRequested={isCreateChannelRequested}
          isNewDirectMessage={isNewDirectMessage}
          messageLoadFailed={false}
          membersLoadFailed={membersPage.failed}
          messages={[]}
          messagesNextCursor={null}
        />
      </>
    );
  }

  const activeOrganizationId = await userService.getActiveOrganizationId();

  const cacheArgs = {
    userId: session?.user.id ?? "",
    // Same org key as ChatMobileRoomList / sidebar (session), not a second
    // userService read that could disagree with the list fetch.
    activeOrganizationId: session?.session.activeOrganizationId ?? null,
  };

  const [coworkerRows, summary, chatRoomsPage] = await Promise.all([
    coworkerService.listCoworkers("chat"),
    // Window is session-derived in Core (`max(Session.updatedAt)`). No stamp.
    taskService.getActivitySummary({
      // In an org the greeting talks about the team, so count the whole
      // workspace rather than only the caller's own tasks.
      scope: activeOrganizationId ? "workspace" : "owned",
    }),
    getPrivateCachedMembershipVisibleRooms(cacheArgs),
  ]);

  let archivedCount = 0;
  if (chatRoomsPage.rooms.length === 0) {
    const archived =
      await getPrivateCachedChatListArchivedAndMembers(cacheArgs);
    archivedCount = archived.archivedChatRoomsPage.rooms.length;
  }

  const mobileSurface = resolveChatRootMobileSurface({
    membershipVisibleCount: chatRoomsPage.rooms.length,
    archivedCount,
  });
  const coworkers = coworkerRows.map(mapDbCoworkerToChatCoworker);

  return (
    <>
      {landingNotice}
      {/* One welcome per breakpoint. The compositions differ enough — six 64px
          teammates versus four at 44px — that CSS alone cannot bridge them. */}
      <div className="hidden min-h-full min-w-0 flex-1 flex-col md:flex">
        <ChatLanding
          coworkers={coworkers}
          isOrganizationWorkspace={activeOrganizationId !== null}
          summary={summary}
          userName={session?.user.name ?? null}
        />
      </div>
      {mobileSurface === "list" ? (
        <ChatMobileRoomList />
      ) : (
        /*
          Cancel authenticated-app-frame main `p-4` on mobile (same `-m-4` as
          the room list + room shell). Without this, the coworker strip
          scrollport is inset 16px and edge avatars clip at the pad, not the
          viewport. Pitch/stats/selected keep their own `px-4` inside
          ChatLandingMobile.
        */
        <div className="bg-background -m-4 flex min-h-full min-w-0 flex-1 flex-col md:hidden">
          <ChatLandingMobile
            coworkers={coworkers}
            isOrganizationWorkspace={activeOrganizationId !== null}
            summary={summary}
            userName={session?.user.name ?? null}
          />
        </div>
      )}
    </>
  );
}
