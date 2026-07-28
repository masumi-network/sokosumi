import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChannelsClient } from "@/app/chat/components/channels-client";
import { loadRoomMessages } from "@/app/chat/load-room-messages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { chatRoomService, userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";

interface ChatRoomPageProps {
  params: Promise<{ roomId: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Channels.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function ChatRoomPage({ params }: ChatRoomPageProps) {
  const [{ roomId }, t, activeOrganization] = await Promise.all([
    params,
    getTranslations("App.Channels"),
    userService.getActiveOrganization(),
  ]);

  if (!activeOrganization) {
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

  const messagesPromise = loadRoomMessages(roomId);

  const [listedChannels, organizationMembers, coworkers, currentMember] =
    await Promise.all([
      chatRoomService.listRooms(),
      userService.getOrganizationMembers(activeOrganization.id),
      coworkerService.listCoworkers("chat"),
      userService.getMyMemberInOrganization(activeOrganization.id),
    ]);

  // Deep-link may miss the membership list (race, or room not yet returned).
  let channels = listedChannels;
  let selectedChannel: ChatRoom | null =
    channels.find((channel) => channel.id === roomId) ?? null;
  if (!selectedChannel) {
    const fetched = await chatRoomService.getRoom(roomId);
    if (!fetched) {
      notFound();
    }
    channels = [fetched, ...channels];
    selectedChannel = fetched;
  }

  const {
    messages,
    nextCursor: messagesNextCursor,
    failed: messageLoadFailed,
  } = await messagesPromise;

  return (
    <ChannelsClient
      activeOrganization={activeOrganization}
      channels={channels}
      organizationMembers={organizationMembers}
      currentUserId={currentMember?.userId ?? ""}
      coworkers={coworkers}
      selectedChannelId={selectedChannel.id}
      isCreateChannelRequested={false}
      isNewDirectMessage={false}
      messageLoadFailed={messageLoadFailed}
      messages={messages}
      messagesNextCursor={messagesNextCursor}
    />
  );
}
