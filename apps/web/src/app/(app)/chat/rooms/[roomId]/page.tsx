import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { RoomsClient } from "@/app/chat/components/rooms-client";
import { loadOrganizationMembers } from "@/app/chat/load-organization-members";
import { loadRoomMessages } from "@/app/chat/load-room-messages";
import DefaultLoading from "@/components/default-loading";
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

function ChatRoomPageFallback() {
  return <DefaultLoading className="h-full min-h-[300px] w-full flex-1 p-8" />;
}

/**
 * Open one room. Avoid `listRooms()` here — sidebar already owns the list, and
 * full pagination blocked first paint after `/chat` → `/chat/rooms/{id}`.
 *
 * Non-member / missing room → soft land on `/chat` (cutover design), not 404.
 */
export async function ChatRoomPageContent({ params }: ChatRoomPageProps) {
  // Defer before any cookies()/headers()-bound work so PPR shell probing does
  // not soft-reject dynamic APIs while filling this Suspense hole.
  await connection();

  const [{ roomId }, t, activeOrganization, session] = await Promise.all([
    params,
    getTranslations("App.Channels"),
    userService.getActiveOrganization(),
    getSession(),
  ]);

  const currentUserId = session?.user.id ?? "";

  // Personal workspace: coworker 1:1 directs may have null organizationId.
  // Guest external channels also open here (host org id set, myAccess=guest).
  if (!activeOrganization) {
    const [selectedRoom, coworkers, messagePage] = await Promise.all([
      chatRoomService.getRoom(roomId),
      coworkerService.listCoworkers("chat"),
      loadRoomMessages(roomId),
    ]);

    if (!selectedRoom) {
      redirect("/chat?notice=room-unavailable");
    }

    const isPersonalDirect =
      selectedRoom.organizationId === null && selectedRoom.kind === "direct";
    const isGuestRoom = selectedRoom.myAccess === "guest";

    if (!isPersonalDirect && !isGuestRoom) {
      return (
        <NoOrganizationCard
          title={t("NoOrganization.title")}
          description={t("NoOrganization.description")}
        />
      );
    }

    return (
      <RoomsClient
        activeOrganization={null}
        rooms={[selectedRoom]}
        organizationMembers={[]}
        currentUserId={currentUserId}
        coworkers={coworkers}
        selectedRoomId={selectedRoom.id}
        isCreateChannelRequested={false}
        isNewDirectMessage={false}
        messageLoadFailed={messagePage.failed}
        membersLoadFailed={false}
        messages={messagePage.messages}
        messagesNextCursor={messagePage.nextCursor}
      />
    );
  }

  const [selectedRoom, membersPage, coworkers, messagePage] = await Promise.all(
    [
      chatRoomService.getRoom(roomId),
      loadOrganizationMembers(activeOrganization.id),
      coworkerService.listCoworkers("chat"),
      loadRoomMessages(roomId),
    ],
  );

  if (!selectedRoom) {
    redirect("/chat?notice=room-unavailable");
  }

  // Active org: host-org rooms, or guest access to another org's external
  // channel (spec: guests never switch into the host org).
  const isHostOrgRoom = selectedRoom.organizationId === activeOrganization.id;
  const isGuestRoom = selectedRoom.myAccess === "guest";
  if (!isHostOrgRoom && !isGuestRoom) {
    redirect("/chat?notice=room-unavailable");
  }

  return (
    <RoomsClient
      activeOrganization={activeOrganization}
      rooms={[selectedRoom]}
      organizationMembers={membersPage.members}
      currentUserId={currentUserId}
      coworkers={coworkers}
      selectedRoomId={selectedRoom.id}
      isCreateChannelRequested={false}
      isNewDirectMessage={false}
      messageLoadFailed={messagePage.failed}
      membersLoadFailed={membersPage.failed}
      messages={messagePage.messages}
      messagesNextCursor={messagePage.nextCursor}
    />
  );
}

export default function ChatRoomPage({ params }: ChatRoomPageProps) {
  return (
    <Suspense fallback={<ChatRoomPageFallback />}>
      <ChatRoomPageContent params={params} />
    </Suspense>
  );
}
