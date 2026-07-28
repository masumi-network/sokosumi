import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChannelsClient } from "@/app/chat/components/channels-client";
import { loadRoomMessages } from "@/app/chat/load-room-messages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/auth.server";
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

/**
 * Open one room. Avoid `listRooms()` here — sidebar already owns the list, and
 * full pagination blocked first paint after `/chat` → `/chat/rooms/{id}`.
 *
 * Non-member / missing room → soft land on `/chat` (cutover design), not 404.
 */
export default async function ChatRoomPage({ params }: ChatRoomPageProps) {
  const [{ roomId }, t, activeOrganization, session] = await Promise.all([
    params,
    getTranslations("App.Channels"),
    userService.getActiveOrganization(),
    getSession(),
  ]);

  const currentUserId = session?.user.id ?? "";

  // Personal workspace: coworker 1:1 directs may have null organizationId.
  if (!activeOrganization) {
    const [selectedChannel, coworkers, messagePage] = await Promise.all([
      chatRoomService.getRoom(roomId),
      coworkerService.listCoworkers("chat"),
      loadRoomMessages(roomId),
    ]);

    if (!selectedChannel) {
      redirect("/chat?notice=room-unavailable");
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

    return (
      <ChannelsClient
        activeOrganization={null}
        channels={[selectedChannel]}
        organizationMembers={[]}
        currentUserId={currentUserId}
        coworkers={coworkers}
        selectedChannelId={selectedChannel.id}
        isCreateChannelRequested={false}
        isNewDirectMessage={false}
        messageLoadFailed={messagePage.failed}
        messages={messagePage.messages}
        messagesNextCursor={messagePage.nextCursor}
      />
    );
  }

  const [selectedChannel, organizationMembers, coworkers, messagePage] =
    await Promise.all([
      chatRoomService.getRoom(roomId),
      userService.getOrganizationMembers(activeOrganization.id),
      coworkerService.listCoworkers("chat"),
      loadRoomMessages(roomId),
    ]);

  if (!selectedChannel) {
    redirect("/chat?notice=room-unavailable");
  }

  return (
    <ChannelsClient
      activeOrganization={activeOrganization}
      channels={[selectedChannel]}
      organizationMembers={organizationMembers}
      currentUserId={currentUserId}
      coworkers={coworkers}
      selectedChannelId={selectedChannel.id}
      isCreateChannelRequested={false}
      isNewDirectMessage={false}
      messageLoadFailed={messagePage.failed}
      messages={messagePage.messages}
      messagesNextCursor={messagePage.nextCursor}
    />
  );
}
