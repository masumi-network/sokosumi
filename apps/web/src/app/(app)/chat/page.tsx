import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ChatLandingNotice } from "@/app/chat/components/chat-landing-notice";
import { ChatWelcomeClient } from "@/app/chat/components/chat-welcome-client";
import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/auth.server";
import { chatRoomService, userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";

import { RoomsClient } from "./components/rooms-client";
import { loadOrganizationMembers } from "./load-organization-members";
import { firstSearchValue } from "./load-room-messages";

interface ChatPageProps {
  searchParams: Promise<{
    create?: string | string[];
    dm?: string | string[];
    notice?: string | string[];
  }>;
}

export async function generateMetadata({
  searchParams,
}: ChatPageProps): Promise<Metadata> {
  const query = await searchParams;
  const isDraftMode =
    firstSearchValue(query.create) === "channel" ||
    firstSearchValue(query.dm) === "new";
  const t = await getTranslations(
    isDraftMode ? "App.Channels.Metadata" : "App.Chat.Metadata",
  );

  return {
    title: t("title"),
    description: t("description"),
  };
}

/**
 * `/chat` landing = classic coworker welcome. Draft modes via query:
 * `?create=channel`, `?dm=new`. Open rooms: `/chat/rooms/[roomId]`.
 */
export default async function ChatPage({ searchParams }: ChatPageProps) {
  const [query, tChannels, activeOrganization, session] = await Promise.all([
    searchParams,
    getTranslations("App.Channels"),
    userService.getActiveOrganization(),
    getSession(),
  ]);

  const isCreateChannelRequested = firstSearchValue(query.create) === "channel";
  const isNewDirectMessage = firstSearchValue(query.dm) === "new";
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
            messages={[]}
            messagesNextCursor={null}
          />
        </>
      );
    }

    const [listedRooms, membersPage, coworkers, currentMember] =
      await Promise.all([
        chatRoomService.listRooms(),
        loadOrganizationMembers(activeOrganization.id),
        coworkerService.listCoworkers("chat"),
        userService.getMyMemberInOrganization(activeOrganization.id),
      ]);

    return (
      <>
        {landingNotice}
        <RoomsClient
          activeOrganization={activeOrganization}
          rooms={listedRooms}
          organizationMembers={membersPage.members}
          currentUserId={currentMember?.userId ?? ""}
          coworkers={coworkers}
          selectedRoomId={null}
          isCreateChannelRequested={isCreateChannelRequested}
          isNewDirectMessage={isNewDirectMessage}
          messageLoadFailed={false}
          messages={[]}
          messagesNextCursor={null}
        />
      </>
    );
  }

  const coworkers = (await coworkerService.listCoworkers("chat")).map(
    mapDbCoworkerToChatCoworker,
  );

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
