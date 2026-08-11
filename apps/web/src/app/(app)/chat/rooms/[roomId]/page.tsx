import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { RoomOpenLoadingView } from "@/app/chat/components/room-open-loading-view";
import { RoomsClient } from "@/app/chat/components/rooms-client";
import { loadOrganizationMembers } from "@/app/chat/load-organization-members";
import { loadRoomMessages } from "@/app/chat/load-room-messages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/auth.server";
import type {
  ChatRoom,
  Coworker,
  Member,
  Organization,
} from "@/lib/clients/generated/core";
import { chatRoomService, userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";

interface ChatRoomPageProps {
  params: Promise<{ roomId: string }>;
}

interface ChatRoomShellProps {
  activeOrganization: Organization | null;
  rooms: ChatRoom[];
  organizationMembers: Member[];
  currentUserId: string;
  coworkers: Coworker[];
  selectedRoomId: string;
  membersLoadFailed: boolean;
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

/**
 * Real header + composer as soon as the room is known; history via promise
 * so the message list can skeleton without blocking chrome (SOK-778).
 * Instant / Suspense: RoomOpenLoadingView (real composer chrome + list bones).
 */
function progressiveRoomOpen(shell: ChatRoomShellProps, roomId: string) {
  const messagesPromise = loadRoomMessages(roomId);

  return (
    <RoomsClient
      activeOrganization={shell.activeOrganization}
      rooms={shell.rooms}
      organizationMembers={shell.organizationMembers}
      currentUserId={shell.currentUserId}
      coworkers={shell.coworkers}
      selectedRoomId={shell.selectedRoomId}
      isCreateChannelRequested={false}
      isNewDirectMessage={false}
      messageLoadFailed={false}
      membersLoadFailed={shell.membersLoadFailed}
      messages={[]}
      messagesNextCursor={null}
      messagesPromise={messagesPromise}
    />
  );
}

/**
 * Open one room. Avoid `listRooms()` here — sidebar already owns the list.
 *
 * Progressive paint (SOK-778):
 * - Instant / outer Suspense: real composer chrome + message-list skeleton
 *   (no full-page spinner; no pulse fake composer).
 * - After room meta: room-aware header + composer + list skeleton.
 * - After history: real messages into the same RoomsClient.
 *
 * Non-member / missing room → soft land on `/chat`, not 404.
 */
export async function ChatRoomPageContent({ params }: ChatRoomPageProps) {
  await connection();

  const [{ roomId }, t, activeOrganization, session] = await Promise.all([
    params,
    getTranslations("App.Channels"),
    userService.getActiveOrganization(),
    getSession(),
  ]);

  const currentUserId = session?.user.id ?? "";

  if (!activeOrganization) {
    const [selectedRoom, coworkers] = await Promise.all([
      chatRoomService.getRoom(roomId),
      coworkerService.listCoworkers("chat"),
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

    return progressiveRoomOpen(
      {
        activeOrganization: null,
        rooms: [selectedRoom],
        organizationMembers: [],
        currentUserId,
        coworkers,
        selectedRoomId: selectedRoom.id,
        membersLoadFailed: false,
      },
      selectedRoom.id,
    );
  }

  const [selectedRoom, membersPage, coworkers] = await Promise.all([
    chatRoomService.getRoom(roomId),
    loadOrganizationMembers(activeOrganization.id),
    coworkerService.listCoworkers("chat"),
  ]);

  if (!selectedRoom) {
    redirect("/chat?notice=room-unavailable");
  }

  const isHostOrgRoom = selectedRoom.organizationId === activeOrganization.id;
  const isGuestRoom = selectedRoom.myAccess === "guest";
  if (!isHostOrgRoom && !isGuestRoom) {
    redirect("/chat?notice=room-unavailable");
  }

  return progressiveRoomOpen(
    {
      activeOrganization,
      rooms: [selectedRoom],
      organizationMembers: membersPage.members,
      currentUserId,
      coworkers,
      selectedRoomId: selectedRoom.id,
      membersLoadFailed: membersPage.failed,
    },
    selectedRoom.id,
  );
}

export default function ChatRoomPage({ params }: ChatRoomPageProps) {
  return (
    <Suspense fallback={<RoomOpenLoadingView />}>
      <ChatRoomPageContent params={params} />
    </Suspense>
  );
}
