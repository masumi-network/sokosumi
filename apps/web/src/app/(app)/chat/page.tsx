import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/auth.server";
import { chatRoomService, userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";

import { ChannelsClient } from "./components/channels-client";
import { firstSearchValue } from "./load-room-messages";

interface ChatPageProps {
  searchParams: Promise<{
    create?: string | string[];
    dm?: string | string[];
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Channels.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

/**
 * Landing `/chat` plus draft modes (`?create=channel`, `?dm=new`).
 * Open rooms live at `/chat/rooms/[roomId]`.
 */
export default async function ChatPage({ searchParams }: ChatPageProps) {
  const [query, t, activeOrganization] = await Promise.all([
    searchParams,
    getTranslations("App.Channels"),
    userService.getActiveOrganization(),
  ]);

  const isCreateChannelRequested = firstSearchValue(query.create) === "channel";
  const isNewDirectMessage = firstSearchValue(query.dm) === "new";

  // Channels / create stay org-only. Start New DM (`?dm=new`) also works in
  // personal workspace: same DraftDirectMessage UI with empty members so the
  // picker is coworkers-only (solo coworker sends via /chat).
  if (!activeOrganization) {
    if (!isNewDirectMessage) {
      return (
        <div className="min-h-full w-full px-4 py-6">
          <div className="mx-auto max-w-3xl">
            <Card>
              <CardHeader>
                <CardTitle>{t("NoOrganization.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  {t("NoOrganization.description")}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }

    const [session, coworkers] = await Promise.all([
      getSession(),
      coworkerService.listCoworkers("chat"),
    ]);

    return (
      <ChannelsClient
        activeOrganization={null}
        channels={[]}
        organizationMembers={[]}
        currentUserId={session?.user.id ?? ""}
        coworkers={coworkers}
        selectedChannelId={null}
        isCreateChannelRequested={false}
        isNewDirectMessage
        messageLoadFailed={false}
        messages={[]}
        messagesNextCursor={null}
      />
    );
  }

  const [listedChannels, organizationMembers, coworkers, currentMember] =
    await Promise.all([
      chatRoomService.listRooms(),
      userService.getOrganizationMembers(activeOrganization.id),
      coworkerService.listCoworkers("chat"),
      userService.getMyMemberInOrganization(activeOrganization.id),
    ]);

  return (
    <ChannelsClient
      activeOrganization={activeOrganization}
      channels={listedChannels}
      organizationMembers={organizationMembers}
      currentUserId={currentMember?.userId ?? ""}
      coworkers={coworkers}
      selectedChannelId={null}
      isCreateChannelRequested={isCreateChannelRequested}
      isNewDirectMessage={isNewDirectMessage}
      messageLoadFailed={false}
      messages={[]}
      messagesNextCursor={null}
    />
  );
}
