import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { ChatLandingNotice } from "@/app/chat/components/chat-landing-notice";
import { ChatWelcomeClient } from "@/app/chat/components/chat-welcome-client";
import { MobileHomeHub } from "@/app/chat/components/mobile-home-hub";
import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/auth.server";
import { hasAdminRole } from "@/lib/auth/has-admin-role";
import { userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { RoomsClient } from "./components/rooms-client";
import { loadOrganizationMembers } from "./load-organization-members";
import { firstSearchValue } from "./load-room-messages";

interface ChatPageProps {
  searchParams: Promise<{
    create?: string | string[];
    dm?: string | string[];
    welcome?: string | string[];
    notice?: string | string[];
  }>;
}

/**
 * Soft-nav: keep previous screen (no Instant shell / route spinner).
 * Rooms still use Instant via `rooms/[roomId]`.
 */
export const instant = false;

/**
 * `/chat` landing: mobile Home hub (sidebar minus Channels/DMs); desktop
 * classic coworker welcome. Draft modes via query: `?create=channel`,
 * `?dm=new`, `?welcome=1` (mobile coworker compose). Open rooms:
 * `/chat/rooms/[roomId]`.
 *
 * Fully async, no route `loading.tsx` — soft nav keeps the previous screen
 * (same as `/history`). Opening a room uses `rooms/[roomId]/loading.tsx`.
 */
export default async function ChatPage({ searchParams }: ChatPageProps) {
  // Defer before any cookies()/headers()-bound work so PPR shell probing does
  // not soft-reject dynamic APIs on this dynamic page.
  await connection();

  const [query, tChannels, activeOrganization, session] = await Promise.all([
    searchParams,
    getTranslations("App.Channels"),
    userService.getActiveOrganization(),
    getSession(),
  ]);

  const isCreateChannelRequested = firstSearchValue(query.create) === "channel";
  const isNewDirectMessage = firstSearchValue(query.dm) === "new";
  const isWelcomeCompose = firstSearchValue(query.welcome) === "1";
  const notice = firstSearchValue(query.notice);
  const landingNotice = <ChatLandingNotice notice={notice} />;

  if (isCreateChannelRequested || isNewDirectMessage) {
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

  const coworkers = (await coworkerService.listCoworkers("chat")).map(
    mapDbCoworkerToChatCoworker,
  );

  if (isWelcomeCompose) {
    return (
      <>
        {landingNotice}
        <ChatWelcomeClient
          coworkers={coworkers}
          userName={session?.user.name ?? undefined}
        />
      </>
    );
  }

  if (!session?.user) {
    return (
      <>
        {landingNotice}
        <div className="hidden md:contents">
          <ChatWelcomeClient coworkers={coworkers} />
        </div>
      </>
    );
  }

  const adminMenuEnabled = hasAdminRole(
    (session.user as typeof session.user & { role?: string | null }).role,
  );

  return (
    <>
      {landingNotice}
      <div className="hidden md:contents">
        <ChatWelcomeClient
          coworkers={coworkers}
          userName={session.user.name ?? undefined}
        />
      </div>
      <MobileHomeHub
        sessionUser={session.user}
        activeOrganizationId={session.session.activeOrganizationId ?? null}
        adminMenuEnabled={adminMenuEnabled}
      />
    </>
  );
}
