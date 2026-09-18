"use client";

import {
  ArrowUpDown,
  Building2,
  Check,
  Ellipsis,
  Globe2,
  Hash,
  MessageCircle,
  Pin,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  acceptChatRoomInvitationAction,
  declineChatRoomInvitationAction,
  deleteRoomAction,
  restoreRoomAction,
} from "@/app/chat/actions";
import { BrowseChannelsDialog } from "@/app/chat/components/browse-channels-dialog";
import { CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME } from "@/app/chat/components/chat-compose-dialog";
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
import type {
  ChatRoom,
  ChatRoomInvitation,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getActiveRoomIdFromPathname } from "./active-room-id";
import { ChannelDiscoverabilityIcon } from "./channel-discoverability-icon";
import { ChannelRoomMark } from "./channel-room-mark";
import {
  ChatRoomSidebarRow,
  type ChatRoomSidebarRowProps,
} from "./chat-room-sidebar-row";
import { ChatSidebarSectionHeader } from "./chat-sidebar-section-header";
import { DirectRoomAvatarStack } from "./direct-room-avatar-stack";
import {
  listOrganizationChatRoomsAction,
  reorderPinnedOrganizationChatRoomsAction,
} from "./organization-chat-list.actions";
import { partitionRoomsForSidebar } from "./partition-rooms-for-sidebar";
import { PendingInvitationRailButton } from "./pending-invitation-rail-button";
import {
  movePinnedRoomId,
  PinnedRoomsDndContext,
  SortablePinnedRoomRow,
} from "./pinned-rooms-dnd";
import { resolveSectionAttention } from "./room-attention";
import { beginRoomAttentionRefresh } from "./room-read-overlay";
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
    applyPinnedOrder,
  } = useOrganizationChatRooms({
    rooms,
    archivedRooms,
    pendingInvitations,
    currentUserId,
    organizationId,
    paintOnly,
  });
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [pinnedReorderMode, setPinnedReorderMode] = useState(false);
  const reorderRequestRef = useRef(0);
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
      const requestRevision = beginRoomAttentionRefresh();
      const roomsResult = await listOrganizationChatRoomsAction();
      setRespondingInvitation(null);
      setPendingRows((current) =>
        current.filter((row) => row.id !== invitation.id),
      );
      if (roomsResult.ok) {
        replaceAllRooms(roomsResult.value.rooms, requestRevision);
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

  const { pinned, directMessages, namedChannels, externalJoined } = useMemo(
    () => partitionRoomsForSidebar(roomRows),
    [roomRows],
  );
  const pinnedRoomIds = pinned.map((room) => room.id);
  const canReorderPinned = pinnedOpen && pinned.length > 1;
  // The mode ends with the toggle that leaves it (section closed, or fewer
  // than two pins). Otherwise it would come back by itself, unasked, the
  // next time a second room is pinned.
  if (pinnedReorderMode && !canReorderPinned) {
    setPinnedReorderMode(false);
  }
  const isReorderingPinned = pinnedReorderMode && canReorderPinned;

  /** Undefined past either end of the list, which is how a row knows. */
  function movePinnedTo(roomId: string, targetId: string | undefined) {
    return targetId
      ? () =>
          handleReorderPinned(movePinnedRoomId(pinnedRoomIds, roomId, targetId))
      : undefined;
  }

  function handleReorderPinned(roomIds: string[]) {
    const request = ++reorderRequestRef.current;
    // Local sort keys only; Core writes its own and the next list load
    // brings them. The order is what matters, and it is the same.
    const base = Date.now() - roomIds.length;
    applyPinnedOrder(
      roomIds.map((roomId, index) => ({
        roomId,
        starredAt: new Date(base + index),
      })),
    );

    async function reloadAfterFailure() {
      // A newer reorder owns the list now.
      if (request !== reorderRequestRef.current) return;
      toast.error(tActions("actionFailed"));
      // What Core holds is the truth: an earlier overlapping reorder may
      // have landed, so no local snapshot is safe to put back.
      const requestRevision = beginRoomAttentionRefresh();
      const roomsResult = await listOrganizationChatRoomsAction();
      if (roomsResult.ok && request === reorderRequestRef.current) {
        replaceAllRooms(roomsResult.value.rooms, requestRevision);
      }
    }

    void reorderPinnedOrganizationChatRoomsAction(roomIds).then((result) => {
      if (!result.ok) return reloadAfterFailure();
    }, reloadAfterFailure);
  }

  function roomRowProps(room: ChatRoom): ChatRoomSidebarRowProps {
    const isDirect = room.kind === "direct";
    return {
      room,
      href: `/chat/rooms/${room.id}`,
      label: isDirect
        ? getRoomDisplayName(room, currentUserId, t("SelfDirect.you"))
        : room.name,
      subtitle:
        room.myAccess === "guest" && room.organizationName
          ? tExternal("hostOrganization", {
              organization: room.organizationName,
            })
          : undefined,
      isActive: activeRoomId === room.id,
      leading: isDirect ? (
        <DirectRoomAvatarStack room={room} currentUserId={currentUserId} />
      ) : (
        <ChannelRoomMark room={room} />
      ),
      onRoomUpdated: replaceRoom,
      dismissSheetOnNavigate,
    };
  }

  const sortedArchivedChannels = useMemo(() => {
    return [...archivedRows].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }, [archivedRows]);

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent className="space-y-2">
        {pinned.length > 0 ? (
          <Collapsible open={pinnedOpen} onOpenChange={setPinnedOpen}>
            <ChatSidebarSectionHeader
              isOpen={pinnedOpen}
              railIcon={Pin}
              closedAttention={resolveSectionAttention(pinned)}
              createAction={
                canReorderPinned ? (
                  <button
                    type="button"
                    aria-pressed={isReorderingPinned}
                    aria-label={t(
                      isReorderingPinned
                        ? "reorderPinnedDone"
                        : "reorderPinned",
                    )}
                    className={CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME}
                    onClick={() => setPinnedReorderMode((current) => !current)}
                  >
                    {isReorderingPinned ? (
                      <Check className="size-4 md:size-3.5" aria-hidden />
                    ) : (
                      <ArrowUpDown className="size-4 md:size-3.5" aria-hidden />
                    )}
                  </button>
                ) : undefined
              }
            >
              {t("pinned")}
            </ChatSidebarSectionHeader>
            <CollapsibleContent>
              {isReorderingPinned ? (
                <PinnedRoomsDndContext
                  roomIds={pinnedRoomIds}
                  onReorder={handleReorderPinned}
                >
                  <SidebarMenu className="gap-0">
                    {pinned.map((room, index) => (
                      <SortablePinnedRoomRow
                        key={room.id}
                        index={index}
                        {...roomRowProps(room)}
                        onMoveUp={movePinnedTo(
                          room.id,
                          pinnedRoomIds[index - 1],
                        )}
                        onMoveDown={movePinnedTo(
                          room.id,
                          pinnedRoomIds[index + 1],
                        )}
                      />
                    ))}
                  </SidebarMenu>
                </PinnedRoomsDndContext>
              ) : (
                <SidebarMenu className="gap-0">
                  {pinned.map((room) => (
                    <ChatRoomSidebarRow key={room.id} {...roomRowProps(room)} />
                  ))}
                </SidebarMenu>
              )}
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {hasOrganization ? (
          <Collapsible
            open={channelSectionOpen}
            onOpenChange={setChannelSectionOpen}
          >
            <ChatSidebarSectionHeader
              isOpen={channelSectionOpen}
              railIcon={Hash}
              closedAttention={resolveSectionAttention(namedChannels)}
              createAction={<CreateChannelDialog />}
              secondaryAction={<BrowseChannelsDialog />}
            >
              {t("title")}
            </ChatSidebarSectionHeader>
            <CollapsibleContent>
              <SidebarMenu className="gap-0">
                {namedChannels.map((room) => (
                  <ChatRoomSidebarRow key={room.id} {...roomRowProps(room)} />
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
            <ChatSidebarSectionHeader
              isOpen={externalOpen}
              railIcon={Building2}
              closedAttention={resolveSectionAttention(externalJoined, {
                hasPendingInvitation: pendingRows.length > 0,
              })}
            >
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
                  const invitationLabel = tExternal("pendingAria", {
                    name: invitation.roomName,
                    organization: invitation.organizationName,
                  });
                  const acceptButtonId = `invitation-accept-${invitation.id}`;
                  return (
                    <SidebarMenuItem key={invitation.id}>
                      <PendingInvitationRailButton
                        roomName={invitation.roomName}
                        label={invitationLabel}
                        acceptButtonId={acceptButtonId}
                      />
                      <div
                        aria-label={invitationLabel}
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
                              id={acceptButtonId}
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
                  <ChatRoomSidebarRow key={room.id} {...roomRowProps(room)} />
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
                      <div className="text-tertiary-foreground dark:text-muted-foreground flex min-h-auto w-full items-center gap-2 px-3 py-1.5 group-data-[collapsible=icon]:hidden">
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
            railIcon={MessageCircle}
            closedAttention={resolveSectionAttention(directMessages)}
            createAction={<CreateDirectDialog />}
          >
            {t("directMessages")}
          </ChatSidebarSectionHeader>
          <CollapsibleContent>
            <SidebarMenu className="gap-0">
              {directMessages.map((room) => (
                <ChatRoomSidebarRow key={room.id} {...roomRowProps(room)} />
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
