import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ChatRoomOpenSkeleton } from "@/app/chat/components/chat-room-open-skeleton";
import { RoomsClient } from "@/app/chat/components/rooms-client";
import { loadOrganizationMembers } from "@/app/chat/load-organization-members";
import { loadRoomMessages } from "@/app/chat/load-room-messages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/auth.server";
import type {
  ChatRoom,
  ChatRoomMessage,
  Coworker,
  Member,
  Organization,
} from "@/lib/clients/generated/core";
import { chatRoomService, userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";

interface ChatRoomPageProps {
  params: Promise<{ roomId: string }>;
}

/** Shell props for progressive open (header + composer) before history. */
export interface ChatRoomShellProps {
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

function RoomsClientFromShell({
  shell,
  messages,
  messagesNextCursor,
  messageLoadFailed,
  messagesPending = false,
}: {
  shell: ChatRoomShellProps;
  messages: ChatRoomMessage[];
  messagesNextCursor: string | null;
  messageLoadFailed: boolean;
  messagesPending?: boolean;
}) {
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
      messageLoadFailed={messageLoadFailed}
      membersLoadFailed={shell.membersLoadFailed}
      messages={messages}
      messagesNextCursor={messagesNextCursor}
      messagesPending={messagesPending}
    />
  );
}

/**
 * Deferred history island. Streams in after the room chrome shell paints.
 * Soft-land for missing/non-member rooms happens in the shell, not here.
 */
export async function ChatRoomWithMessages({
  shell,
  roomId,
}: {
  shell: ChatRoomShellProps;
  roomId: string;
}) {
  const messagePage = await loadRoomMessages(roomId);
  return (
    <RoomsClientFromShell
      shell={shell}
      messages={messagePage.messages}
      messagesNextCursor={messagePage.nextCursor}
      messageLoadFailed={messagePage.failed}
    />
  );
}

/** Progressive room open: chrome shell first, history behind Suspense. */
function progressiveRoomOpen(shell: ChatRoomShellProps, roomId: string) {
  return (
    <Suspense
      fallback={
        <RoomsClientFromShell
          shell={shell}
          messages={[]}
          messagesNextCursor={null}
          messageLoadFailed={false}
          messagesPending
        />
      }
    >
      <ChatRoomWithMessages shell={shell} roomId={roomId} />
    </Suspense>
  );
}

/**
 * Open one room. Avoid `listRooms()` here — sidebar already owns the list, and
 * full pagination blocked first paint after `/chat` → `/chat/rooms/{id}`.
 *
 * Progressive paint: resolve room chrome (header + composer) first; stream
 * message history behind an inner Suspense with a skeleton list fallback.
 * Never show invented or half-rendered message bodies.
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

    const shell: ChatRoomShellProps = {
      activeOrganization: null,
      rooms: [selectedRoom],
      organizationMembers: [],
      currentUserId,
      coworkers,
      selectedRoomId: selectedRoom.id,
      membersLoadFailed: false,
    };

    return progressiveRoomOpen(shell, selectedRoom.id);
  }

  const [selectedRoom, membersPage, coworkers] = await Promise.all([
    chatRoomService.getRoom(roomId),
    loadOrganizationMembers(activeOrganization.id),
    coworkerService.listCoworkers("chat"),
  ]);

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

  const shell: ChatRoomShellProps = {
    activeOrganization,
    rooms: [selectedRoom],
    organizationMembers: membersPage.members,
    currentUserId,
    coworkers,
    selectedRoomId: selectedRoom.id,
    membersLoadFailed: membersPage.failed,
  };

  return progressiveRoomOpen(shell, selectedRoom.id);
}

export default function ChatRoomPage({ params }: ChatRoomPageProps) {
  return (
    <Suspense fallback={<ChatRoomOpenSkeleton />}>
      <ChatRoomPageContent params={params} />
    </Suspense>
  );
}
