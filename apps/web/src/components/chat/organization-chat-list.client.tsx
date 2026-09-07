"use client";

import { Ellipsis, Globe2, RotateCcw, Trash2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  acceptChatRoomInvitationAction,
  declineChatRoomInvitationAction,
  deleteRoomAction,
  restoreRoomAction,
} from "@/app/chat/actions";
import { BrowseChannelsDialog } from "@/app/chat/components/browse-channels-dialog";
import { CreateChannelDialog } from "@/app/chat/components/create-channel-dialog";
import { CreateDirectDialog } from "@/app/chat/components/create-direct-dialog";
import { getRoomDisplayName } from "@/app/chat/components/room-helpers";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { useChatUnreadDocumentTitle } from "@/hooks/use-chat-unread-document-title";
import type {
  ChatRoom,
  ChatRoomInvitation,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getActiveRoomIdFromPathname } from "./active-room-id";
import { ChannelDiscoverabilityIcon } from "./channel-discoverability-icon";
import { ChatMembershipRevokedListBridge } from "./chat-membership-revoked-list-bridge";
import { ChatRoomSidebarRow } from "./chat-room-sidebar-row";
import { ChatSidebarSectionHeader } from "./chat-sidebar-section-header";
import { countChatRoomsWithUnreadAttention } from "./chat-unread-document-title";
import { DirectRoomAvatarStack } from "./direct-room-avatar-stack";
import { listOrganizationChatRoomsAction } from "./organization-chat-list.actions";
import { partitionRoomsForSidebar } from "./partition-rooms-for-sidebar";
import { useOrganizationChatRooms } from "./use-organization-chat-rooms";

/** Stable empty default — inline `= []` is a new array every render and
 *  infinite-loops the render-time pendingInvitations sync (React #301). */
const EMPTY_PENDING_INVITATIONS: ChatRoomInvitation[] = [];

/** Same absolute slot as live room rows so archived height matches Channels/DMs. */
const ARCHIVED_TRAILING_CONTROL_CLASS =
  "absolute top-1/2 right-1 z-10 flex size-8 -translate-y-1/2 items-center justify-center md:size-7";

interface OrganizationChatListProps {
  rooms: ChatRoom[];
  archivedRooms: ChatRoom[];
  pendingInvitations?: ChatRoomInvitation[];
  currentUserId: string;
  organizationId: string | null;
  canDeleteArchivedRooms?: boolean;
  /**
   * Wrap room/section links in Radix `SheetClose` (sidebar Sheet).
   * Set false when the list is page-mounted outside a Sheet.
   */
  dismissSheetOnNavigate?: boolean;
  /**
   * Instant soft-nav paint (SOK-903): same section/row chrome as the live list,
   * without Ably or membership refresh — avoids layout jump when RSC lands.
   */
  paintOnly?: boolean;
}

export function OrganizationChatList({
  rooms,
  archivedRooms,
  pendingInvitations = EMPTY_PENDING_INVITATIONS,
  currentUserId,
  organizationId,
  canDeleteArchivedRooms = false,
  dismissSheetOnNavigate = true,
  paintOnly = false,
}: OrganizationChatListProps) {
  const t = useTranslations("App.Channels");
  const tExternal = useTranslations("App.Channels.External");
  const tActions = useTranslations("App.Channels.Actions");
  const pathname = usePathname();
  const router = useRouter();
  const hasOrganization = Boolean(organizationId);
  const {
    roomRows,
    archivedRows,
    pendingRows,
    setArchivedRows,
    setPendingRows,
    upsertRoomToTop,
    replaceRoom,
    replaceAllRooms,
  } = useOrganizationChatRooms({
    rooms,
    archivedRooms,
    pendingInvitations,
    currentUserId,
    organizationId,
    paintOnly,
  });
  const [channelSectionOpen, setChannelSectionOpen] = useState(true);
  const [archivedSectionOpen, setArchivedSectionOpen] = useState(false);
  const [directOpen, setDirectOpen] = useState(true);
  const [externalOpen, setExternalOpen] = useState(true);
  const [restoringRoomId, setRestoringRoomId] = useState<string | null>(null);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const [pendingDeleteRoom, setPendingDeleteRoom] = useState<ChatRoom | null>(
    null,
  );
  const [respondingInvitation, setRespondingInvitation] = useState<{
    id: string;
    action: "accept" | "decline";
  } | null>(null);
  const [_isRestoring, startRestoreTransition] = useTransition();
  const [_isDeleting, startDeleteTransition] = useTransition();
  const [_isRespondingInvite, startInviteResponseTransition] = useTransition();
  const activeRoomId = getActiveRoomIdFromPathname(pathname);
  const unreadRoomCount = countChatRoomsWithUnreadAttention(roomRows, {
    activeRoomId,
  });
  useChatUnreadDocumentTitle(unreadRoomCount);

  const membershipRevokedBridge =
    !paintOnly && currentUserId.length > 0 ? (
      <LazyAblyProvider>
        <ChatMembershipRevokedListBridge currentUserId={currentUserId} />
      </LazyAblyProvider>
    ) : null;

  function handleRestoreRoom(room: ChatRoom) {
    if (restoringRoomId || deletingRoomId) {
      return;
    }
    setRestoringRoomId(room.id);
    startRestoreTransition(async () => {
      const result = await restoreRoomAction(room.id);
      setRestoringRoomId(null);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(tActions("restoreSuccess", { name: room.name }));
      upsertRoomToTop(result.value);
      router.push(`/chat/rooms/${result.value.id}`);
      router.refresh();
    });
  }

  function handleConfirmDeleteRoom() {
    const room = pendingDeleteRoom;
    if (!room || restoringRoomId || deletingRoomId) {
      return;
    }
    setDeletingRoomId(room.id);
    startDeleteTransition(async () => {
      const result = await deleteRoomAction(room.id);
      setDeletingRoomId(null);
      setPendingDeleteRoom(null);
      if (!result.ok) {
        toast.error(result.error.message || tActions("deleteError"));
        return;
      }
      toast.success(tActions("deleteSuccess", { name: room.name }));
      setArchivedRows((current) => current.filter((row) => row.id !== room.id));
      router.refresh();
    });
  }

  function handleAcceptInvitation(invitation: ChatRoomInvitation) {
    if (respondingInvitation) {
      return;
    }
    setRespondingInvitation({ id: invitation.id, action: "accept" });
    startInviteResponseTransition(async () => {
      const result = await acceptChatRoomInvitationAction(invitation.id);
      if (!result.ok) {
        setRespondingInvitation(null);
        toast.error(result.error.message || tExternal("acceptError"));
        return;
      }
      toast.success(tExternal("acceptSuccess", { name: invitation.roomName }));
      // Drop pending and upsert rooms in the same tick so External does not
      // unmount between the last invite and the joined guest room.
      const roomsResult = await listOrganizationChatRoomsAction();
      setRespondingInvitation(null);
      setPendingRows((current) =>
        current.filter((row) => row.id !== invitation.id),
      );
      if (roomsResult.ok) {
        replaceAllRooms(roomsResult.value.rooms);
      }
      router.push(`/chat/rooms/${invitation.roomId}`);
      router.refresh();
    });
  }

  function handleDeclineInvitation(invitation: ChatRoomInvitation) {
    if (respondingInvitation) {
      return;
    }
    setRespondingInvitation({ id: invitation.id, action: "decline" });
    startInviteResponseTransition(async () => {
      const result = await declineChatRoomInvitationAction(invitation.id);
      setRespondingInvitation(null);
      if (!result.ok) {
        toast.error(result.error.message || tExternal("declineError"));
        return;
      }
      toast.success(tExternal("declineSuccess"));
      setPendingRows((current) =>
        current.filter((row) => row.id !== invitation.id),
      );
      router.refresh();
    });
  }

  const { directMessages, namedChannels, externalJoined } = useMemo(
    () => partitionRoomsForSidebar(roomRows),
    [roomRows],
  );

  const sortedArchivedChannels = useMemo(() => {
    return [...archivedRows].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }, [archivedRows]);

  return (
    <SidebarGroup className="w-full">
      {membershipRevokedBridge}
      <SidebarGroupContent className="space-y-2">
        {hasOrganization ? (
          <Collapsible
            open={channelSectionOpen}
            onOpenChange={setChannelSectionOpen}
          >
            <ChatSidebarSectionHeader
              isOpen={channelSectionOpen}
              createAction={<CreateChannelDialog />}
              secondaryAction={<BrowseChannelsDialog />}
            >
              {t("title")}
            </ChatSidebarSectionHeader>
            <CollapsibleContent>
              <SidebarMenu className="gap-0">
                {namedChannels.map((room) => (
                  <ChatRoomSidebarRow
                    key={room.id}
                    room={room}
                    href={`/chat/rooms/${room.id}`}
                    label={room.name}
                    isActive={activeRoomId === room.id}
                    leading={
                      <ChannelDiscoverabilityIcon
                        discoverability={room.discoverability}
                      />
                    }
                    onRoomUpdated={replaceRoom}
                    dismissSheetOnNavigate={dismissSheetOnNavigate}
                  />
                ))}
                {namedChannels.length === 0 ? (
                  <SidebarMenuItem>
                    <div className="text-muted-foreground px-3 py-1.5 text-xs group-data-[collapsible=icon]:hidden">
                      {t("Empty.noChannels")}
                    </div>
                  </SidebarMenuItem>
                ) : null}
              </SidebarMenu>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {pendingRows.length > 0 || externalJoined.length > 0 ? (
          <Collapsible open={externalOpen} onOpenChange={setExternalOpen}>
            <ChatSidebarSectionHeader isOpen={externalOpen}>
              {tExternal("title")}
            </ChatSidebarSectionHeader>
            <CollapsibleContent>
              <SidebarMenu className="gap-0">
                {pendingRows.map((invitation) => {
                  const anyBusy = respondingInvitation !== null;
                  const acceptBusy =
                    respondingInvitation?.id === invitation.id &&
                    respondingInvitation.action === "accept";
                  const declineBusy =
                    respondingInvitation?.id === invitation.id &&
                    respondingInvitation.action === "decline";
                  return (
                    <SidebarMenuItem key={invitation.id}>
                      <div
                        aria-label={tExternal("pendingAria", {
                          name: invitation.roomName,
                          organization: invitation.organizationName,
                        })}
                        className="text-tertiary-foreground dark:text-muted-foreground flex min-h-auto w-full items-start gap-2 px-3 py-1.5 group-data-[collapsible=icon]:hidden"
                      >
                        <Globe2
                          className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-foreground">
                            {invitation.roomName}
                          </div>
                          <div className="text-muted-foreground truncate text-xs leading-tight">
                            {invitation.organizationName}
                          </div>
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="default"
                              className="h-6 px-2 text-xs"
                              disabled={anyBusy}
                              onClick={() => handleAcceptInvitation(invitation)}
                            >
                              {acceptBusy ? t("loading") : tExternal("accept")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              disabled={anyBusy}
                              onClick={() =>
                                handleDeclineInvitation(invitation)
                              }
                            >
                              {declineBusy
                                ? t("loading")
                                : tExternal("decline")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </SidebarMenuItem>
                  );
                })}
                {externalJoined.map((room) => (
                  <ChatRoomSidebarRow
                    key={room.id}
                    room={room}
                    href={`/chat/rooms/${room.id}`}
                    label={room.name}
                    subtitle={
                      room.myAccess === "guest" && room.organizationName
                        ? tExternal("hostOrganization", {
                            organization: room.organizationName,
                          })
                        : undefined
                    }
                    isActive={activeRoomId === room.id}
                    leading={
                      <ChannelDiscoverabilityIcon discoverability="external" />
                    }
                    onRoomUpdated={replaceRoom}
                    dismissSheetOnNavigate={dismissSheetOnNavigate}
                  />
                ))}
              </SidebarMenu>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {hasOrganization && sortedArchivedChannels.length > 0 ? (
          <Collapsible
            open={archivedSectionOpen}
            onOpenChange={setArchivedSectionOpen}
          >
            <ChatSidebarSectionHeader isOpen={archivedSectionOpen}>
              {t("archivedChannels")}
            </ChatSidebarSectionHeader>
            <CollapsibleContent>
              <SidebarMenu className="gap-0">
                {sortedArchivedChannels.map((room) => {
                  const isRestoring = restoringRoomId === room.id;
                  const isDeleting = deletingRoomId === room.id;
                  const actionBusy =
                    restoringRoomId !== null || deletingRoomId !== null;
                  const showOverflowMenu = canDeleteArchivedRooms;
                  return (
                    <SidebarMenuItem
                      key={room.id}
                      className="group/room-row relative"
                    >
                      <div className="text-tertiary-foreground dark:text-muted-foreground flex min-h-auto w-full items-center gap-2 px-3 py-1.5">
                        <ChannelDiscoverabilityIcon
                          className="opacity-60"
                          discoverability={room.discoverability}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {room.name}
                        </span>
                        <span
                          className="size-8 shrink-0 md:size-7"
                          aria-hidden
                        />
                      </div>
                      {showOverflowMenu ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={actionBusy}
                              className={cn(
                                ARCHIVED_TRAILING_CONTROL_CLASS,
                                "group-data-[collapsible=icon]:hidden text-muted-foreground",
                                isRestoring || isDeleting
                                  ? "opacity-100"
                                  : "opacity-0 group-focus-within/room-row:opacity-100 group-hover/room-row:opacity-100 data-[state=open]:opacity-100",
                              )}
                              aria-label={tActions("roomMenu", {
                                name: room.name,
                              })}
                            >
                              <Ellipsis
                                className={cn(
                                  "size-5 md:size-4",
                                  (isRestoring || isDeleting) &&
                                    "animate-pulse",
                                )}
                                aria-hidden
                              />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              disabled={actionBusy}
                              onSelect={() => handleRestoreRoom(room)}
                            >
                              <RotateCcw className="size-4" aria-hidden />
                              {tActions("restore")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={actionBusy}
                              variant="destructive"
                              onSelect={() => setPendingDeleteRoom(room)}
                            >
                              <Trash2 className="size-4" aria-hidden />
                              {tActions("delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn(
                            ARCHIVED_TRAILING_CONTROL_CLASS,
                            "group-data-[collapsible=icon]:hidden text-muted-foreground",
                            isRestoring
                              ? "opacity-100"
                              : "opacity-0 group-focus-within/room-row:opacity-100 group-hover/room-row:opacity-100",
                          )}
                          disabled={actionBusy}
                          onClick={() => handleRestoreRoom(room)}
                          aria-label={`${tActions("restore")} ${room.name}`}
                        >
                          <RotateCcw
                            className={cn(
                              "size-3.5",
                              isRestoring && "animate-spin",
                            )}
                            aria-hidden
                          />
                        </Button>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <AlertDialog
          open={pendingDeleteRoom !== null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && deletingRoomId === null) {
              setPendingDeleteRoom(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pendingDeleteRoom
                  ? tActions("deleteConfirmTitle", {
                      name: pendingDeleteRoom.name,
                    })
                  : null}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDeleteRoom
                  ? tActions("deleteConfirmDescription", {
                      name: pendingDeleteRoom.name,
                    })
                  : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingRoomId !== null}>
                {tActions("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={deletingRoomId !== null}
                onClick={(event) => {
                  event.preventDefault();
                  handleConfirmDeleteRoom();
                }}
              >
                {tActions("deleteConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Collapsible open={directOpen} onOpenChange={setDirectOpen}>
          {/*
            Sidebar rows = messaged history only. `+` opens Start New Direct
            in place (org members + coworkers, 1:1 coworker / group humans).
            Personal workspace still mounts the picker with empty members
            (coworkers only).
          */}
          <ChatSidebarSectionHeader
            isOpen={directOpen}
            createAction={<CreateDirectDialog />}
          >
            {t("directMessages")}
          </ChatSidebarSectionHeader>
          <CollapsibleContent>
            <SidebarMenu className="gap-0">
              {directMessages.map((room) => (
                <ChatRoomSidebarRow
                  key={room.id}
                  room={room}
                  href={`/chat/rooms/${room.id}`}
                  label={getRoomDisplayName(room, currentUserId)}
                  isActive={activeRoomId === room.id}
                  leading={
                    <DirectRoomAvatarStack
                      room={room}
                      currentUserId={currentUserId}
                      canOpenHumanDirect={hasOrganization}
                      selectedRoomId={activeRoomId}
                    />
                  }
                  onRoomUpdated={replaceRoom}
                  dismissSheetOnNavigate={dismissSheetOnNavigate}
                />
              ))}
              {directMessages.length === 0 ? (
                <SidebarMenuItem>
                  <div className="text-muted-foreground px-3 py-1.5 text-xs group-data-[collapsible=icon]:hidden">
                    {t("Empty.noDirectMessages")}
                  </div>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </CollapsibleContent>
        </Collapsible>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
