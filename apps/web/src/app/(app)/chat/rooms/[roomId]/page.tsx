import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { RoomRouteBootstrap } from "@/app/chat/components/persistent-room-view";
import { RoomOpenLoadingView } from "@/app/chat/components/room-open-loading-view";
import { loadRoomShellRoster } from "@/app/chat/load-room-shell-roster";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/auth.server";
import type { ChatRoom, Organization } from "@/lib/clients/generated/core";
import { chatRoomService } from "@/lib/services/chat-room.service";
import { userService } from "@/lib/services/user.service";
import { isUuidString } from "@/lib/utils/uuid";

interface ChatRoomPageProps {
  params: Promise<{ roomId: string }>;
}

/**
 * Sentinel only — never a real room. This Instant route already has a
 * non-empty loading shell (`Suspense` + loading view). Without at least one
 * generateStaticParams child, cacheComponents leaves `roomId` not
 * remaining-prerenderable; Vercel then strips it to the `[roomId]`
 * placeholder on resume and throws E592 (SOKOSUMI-RF / next.js#98647). The
 * sentinel marks `roomId` remaining-prerenderable. The dynamic entry can
 * still be `fallback: "/chat/rooms/[roomId]"` with postponed state.
 */
export function generateStaticParams() {
  return [{ roomId: "00000000-0000-4000-8000-000000000000" }];
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

/** Org-less matched channels open via roster membership, not host-org context. */
function isMatchedMemberChannel(
  room: Pick<
    ChatRoom,
    "organizationId" | "kind" | "discoverability" | "myAccess"
  >,
): boolean {
  return (
    room.organizationId === null &&
    room.kind === "channel" &&
    room.discoverability === "matched" &&
    room.myAccess === "member"
  );
}

function NoOrganizationCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="min-h-full w-full py-6">
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
 * Validate room access and register chrome without waiting for history.
 * Every room reads through its retained client transcript; the roster streams
 * separately through a promise.
 */
function progressiveRoomOpen(shell: ChatRoomShellProps) {
  const rosterPromise = loadRoomShellRoster(shell.organizationIdForRoster);

  return (
    <RoomRouteBootstrap
      loadHistoryOnClient
      activeOrganization={shell.activeOrganization}
      rooms={shell.rooms}
      organizationMembers={[]}
      currentUserId={shell.currentUserId}
      coworkers={[]}
      selectedRoomId={shell.selectedRoomId}
      messageLoadFailed={false}
      membersLoadFailed={false}
      messages={[]}
      messagesNextCursor={null}
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
    const isMatchedRoom = isMatchedMemberChannel(selectedRoom);

    if (!isPersonalDirect && !isGuestRoom && !isMatchedRoom) {
      return (
        <NoOrganizationCard
          title={t("NoOrganization.title")}
          description={t("NoOrganization.description")}
        />
      );
    }

    return progressiveRoomOpen({
      activeOrganization: null,
      rooms: [selectedRoom],
      currentUserId,
      selectedRoomId: selectedRoom.id,
      organizationIdForRoster: null,
    });
  }

  const selectedRoom = await chatRoomService.getRoom(roomId);

  if (!selectedRoom) {
    redirect(ROOM_UNAVAILABLE_HREF);
  }

  const isHostOrgRoom = selectedRoom.organizationId === activeOrganization.id;
  const isGuestRoom = selectedRoom.myAccess === "guest";
  const isPersonalDirect =
    selectedRoom.organizationId === null &&
    selectedRoom.kind === "direct" &&
    selectedRoom.coworkerMembers.length === 0;
  const isMatchedRoom = isMatchedMemberChannel(selectedRoom);
  if (!isHostOrgRoom && !isGuestRoom && !isPersonalDirect && !isMatchedRoom) {
    redirect(ROOM_UNAVAILABLE_HREF);
  }

  return progressiveRoomOpen({
    activeOrganization,
    rooms: [selectedRoom],
    currentUserId,
    selectedRoomId: selectedRoom.id,
    organizationIdForRoster: activeOrganization.id,
  });
}

export default function ChatRoomPage({ params }: ChatRoomPageProps) {
  return (
    <Suspense fallback={<RoomOpenLoadingView />}>
      <ChatRoomPageContent params={params} />
    </Suspense>
  );
}
