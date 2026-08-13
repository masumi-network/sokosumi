import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { RoomOpenLoadingView } from "@/app/chat/components/room-open-loading-view";
import { RoomsClient } from "@/app/chat/components/rooms-client";
import { loadRoomMessages } from "@/app/chat/load-room-messages";
import { loadRoomShellRoster } from "@/app/chat/load-room-shell-roster";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/auth.server";
import type { ChatRoom, Organization } from "@/lib/clients/generated/core";
import { chatRoomService, userService } from "@/lib/services";

interface ChatRoomPageProps {
  params: Promise<{ roomId: string }>;
}

interface ChatRoomShellProps {
  activeOrganization: Organization | null;
  rooms: ChatRoom[];
  currentUserId: string;
  selectedRoomId: string;
  /** Null when personal workspace has no org roster to load. */
  organizationIdForRoster: string | null;
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
 * Real header + composer as soon as the room is known; history + roster via
 * promises so chrome is not blocked (SOK-778 history; roster deferred for LCP).
 * Instant / Suspense: RoomOpenLoadingView (real composer chrome + list bones).
 */
function progressiveRoomOpen(shell: ChatRoomShellProps, roomId: string) {
  const messagesPromise = loadRoomMessages(roomId);
  const rosterPromise = loadRoomShellRoster(shell.organizationIdForRoster);

  return (
    <RoomsClient
      activeOrganization={shell.activeOrganization}
      rooms={shell.rooms}
      organizationMembers={[]}
      currentUserId={shell.currentUserId}
      coworkers={[]}
      selectedRoomId={shell.selectedRoomId}
      isCreateChannelRequested={false}
      isNewDirectMessage={false}
      messageLoadFailed={false}
      membersLoadFailed={false}
      messages={[]}
      messagesNextCursor={null}
      messagesPromise={messagesPromise}
      rosterPromise={rosterPromise}
    />
  );
}

/**
 * Open one room. Avoid `listRooms()` here — sidebar already owns the list.
 *
 * Progressive paint:
 * - Instant / outer Suspense: real composer chrome + message-list skeleton
 *   (no full-page spinner; no pulse fake composer).
 * - After room meta (`getRoom` only): room-aware header + composer + list skeleton.
 * - After history / roster: messages + members/coworkers into the same RoomsClient.
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
    const selectedRoom = await chatRoomService.getRoom(roomId);

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
        currentUserId,
        selectedRoomId: selectedRoom.id,
        organizationIdForRoster: null,
      },
      selectedRoom.id,
    );
  }

  const selectedRoom = await chatRoomService.getRoom(roomId);

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
      currentUserId,
      selectedRoomId: selectedRoom.id,
      organizationIdForRoster: activeOrganization.id,
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
