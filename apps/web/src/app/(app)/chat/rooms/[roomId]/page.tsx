import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChannelsClient } from "@/app/chat/components/channels-client";
import { loadRoomMessages } from "@/app/chat/load-room-messages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/auth.server";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { chatRoomService, userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";

interface ChatRoomPageProps {
  params: Promise<{ roomId: string }>;
}

function NoOrganizationCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="min-h-full w-full px-4 py-6">
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{description}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
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

  // Personal workspace: coworker 1:1 directs may have null organizationId.
  // Channels (and org-scoped directs) still require an active organization.
  if (!activeOrganization) {
    const messagesPromise = loadRoomMessages(roomId);
    const [session, listedChannels, coworkers, fetched] = await Promise.all([
      getSession(),
      chatRoomService.listRooms(),
      coworkerService.listCoworkers("chat"),
      chatRoomService.getRoom(roomId),
    ]);

    let channels = listedChannels;
    let selectedChannel: ChatRoom | null =
      channels.find((channel) => channel.id === roomId) ?? null;
    if (!selectedChannel) {
      if (!fetched) {
        notFound();
      }
      channels = [fetched, ...channels];
      selectedChannel = fetched;
    }

    if (
      selectedChannel.organizationId !== null ||
      selectedChannel.kind !== "direct"
    ) {
      return (
        <NoOrganizationCard
          title={t("NoOrganization.title")}
          description={t("NoOrganization.description")}
        />
      );
    }

    const {
      messages,
      nextCursor: messagesNextCursor,
      failed: messageLoadFailed,
    } = await messagesPromise;

    return (
      <ChannelsClient
        activeOrganization={null}
        channels={channels}
        organizationMembers={[]}
        currentUserId={session?.user.id ?? ""}
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
