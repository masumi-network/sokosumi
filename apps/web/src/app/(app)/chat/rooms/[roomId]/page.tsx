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
import { isUuidString } from "@/lib/utils/uuid";

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

const ROOM_UNAVAILABLE_HREF = "/?notice=room-unavailable";

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
 * Real header + live composer as soon as the room is known; history + roster
 * via promises so chrome is not blocked (SOK-778 history; roster deferred
 * for LCP). Instant / Suspense: RoomOpenLoadingView (list bones + disabled
 * composer chrome).
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
 * Progressive paint (mobile LCP):
 * Instant/Suspense fallback paints disabled composer chrome + list bones so
 * the room is not a composer-less hole. After `getRoom`, RoomsClient paints
 * real title + live composer; roster/history stream in via promises.
 *
 * Non-member / missing / invalid room id → soft land on `/`, not error card.
 * Do not start roster/history until access succeeds.
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

  // Core path params are UUIDs — invalid ids 400 before 404. Redirect without
  // calling getRoom / roster / history so Instant composer is not followed by
  // RoomsClient or Chat Error.
  if (!isUuidString(roomId)) {
    redirect(ROOM_UNAVAILABLE_HREF);
  }

  if (!activeOrganization) {
    const selectedRoom = await chatRoomService.getRoom(roomId);

    if (!selectedRoom) {
      redirect(ROOM_UNAVAILABLE_HREF);
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
    redirect(ROOM_UNAVAILABLE_HREF);
  }

  const isHostOrgRoom = selectedRoom.organizationId === activeOrganization.id;
  const isGuestRoom = selectedRoom.myAccess === "guest";
  const isPersonalDirect =
    selectedRoom.organizationId === null && selectedRoom.kind === "direct";
  if (!isHostOrgRoom && !isGuestRoom && !isPersonalDirect) {
    redirect(ROOM_UNAVAILABLE_HREF);
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
