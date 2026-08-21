"use client";

import {
  ChevronDown,
  Ellipsis,
  Globe2,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  acceptChatRoomInvitationAction,
  declineChatRoomInvitationAction,
  deleteRoomAction,
  listPendingChatRoomInvitationsAction,
  restoreRoomAction,
} from "@/app/chat/actions";
import { BrowseChannelsDialog } from "@/app/chat/components/browse-channels-dialog";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { useChatUnreadDocumentTitle } from "@/hooks/use-chat-unread-document-title";
import { useChatMembershipRevokedControl } from "@/lib/ably/use-chat-membership-revoked-control";
import type {
  ChatRoom,
  ChatRoomInvitation,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { ChannelDiscoverabilityIcon } from "./channel-discoverability-icon";
import { ChatRoomSidebarRow } from "./chat-room-sidebar-row";
import { countChatRoomsWithUnreadAttention } from "./chat-unread-document-title";
import { DirectRoomAvatarStack } from "./direct-room-avatar-stack";
import {
  notifyOrganizationChatRoomsChanged,
  ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
  type OrganizationChatRoomsChangedDetail,
} from "./organization-chat-events";
import {
  listOrganizationArchivedChatRoomsAction,
  listOrganizationChatRoomsAction,
} from "./organization-chat-list.actions";
import { partitionRoomsForSidebar } from "./partition-rooms-for-sidebar";
import {
  applyRoomReadOverlays,
  applyRoomReadResultToOverlay,
} from "./room-read-overlay";

const ORGANIZATION_CHAT_POLL_MS = 15_000;

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
}

function SectionHeader({
  children,
  href,
  isOpen,
  label,
  secondaryAction,
  dismissSheetOnNavigate = true,
}: {
  children: ReactNode;
  href?: string;
  isOpen: boolean;
  label?: string;
  secondaryAction?: ReactNode;
  dismissSheetOnNavigate?: boolean;
}) {
  // Create `+` visible on mobile → `?create=channel` / `?dm=new`; Browse stays.
  const createHref = href && label ? href : null;
  const mobileTrailingCount = (secondaryAction ? 1 : 0) + (createHref ? 1 : 0);
  const desktopTrailingCount = (secondaryAction ? 1 : 0) + (createHref ? 1 : 0);
  const hasTrailing = mobileTrailingCount > 0 || desktopTrailingCount > 0;

  const createLink = createHref ? (
    <Link
      aria-label={label}
      className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground relative flex size-7 items-center justify-center rounded-md transition-colors before:absolute before:-inset-2 before:content-[''] sm:before:hidden"
      href={createHref}
    >
      <Plus className="size-4 md:size-3.5" aria-hidden />
    </Link>
  ) : null;

  return (
    <div className="group-data-[collapsible=icon]:hidden relative flex h-10 items-center gap-1 px-3 md:h-8">
      <CollapsibleTrigger
        className={cn(
          "text-muted-foreground hover:text-foreground flex min-w-0 flex-1 items-center gap-1 rounded-md text-left text-base font-medium transition-colors md:text-xs",
          mobileTrailingCount === 1 && "pr-9",
          mobileTrailingCount >= 2 && "pr-16",
          desktopTrailingCount === 0 && "md:pr-0",
          desktopTrailingCount === 1 && "md:pr-8",
          desktopTrailingCount >= 2 && "md:pr-14",
        )}
      >
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 transition-transform md:size-3",
            !isOpen && "-rotate-90",
          )}
        />
        <span className="truncate">{children}</span>
      </CollapsibleTrigger>
      {hasTrailing ? (
        <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
          {secondaryAction}
          {createLink ? (
            dismissSheetOnNavigate ? (
              <SheetClose asChild>{createLink}</SheetClose>
            ) : (
              createLink
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function getActiveRoomIdFromPathname(pathname: string | null): string | null {
  if (!pathname?.startsWith("/chat/rooms/")) {
    return null;
  }

  const roomId = pathname.split("/")[3];
  return roomId || null;
}

/**
 * List-mounted control-channel UI (SOK-746). Soft-removes membership-visible
 * rooms when kicked even if the open-room Ably island is not mounted.
 * Navigation/refresh lives only on the open-room bridge so both mounts never
 * double `replace`/`refresh` for the same event.
 */
function ChatMembershipRevokedListBridge({
  currentUserId,
}: {
  currentUserId: string;
}) {
  useChatMembershipRevokedControl({
    currentUserId,
    onRevoked: (event) => {
      notifyOrganizationChatRoomsChanged({ removedRoomId: event.roomId });
    },
  });

  return null;
}

export function OrganizationChatList({
  rooms,
  archivedRooms,
  pendingInvitations = EMPTY_PENDING_INVITATIONS,
  currentUserId,
  organizationId,
  canDeleteArchivedRooms = false,
  dismissSheetOnNavigate = true,
}: OrganizationChatListProps) {
  const t = useTranslations("App.Channels");
  const tExternal = useTranslations("App.Channels.External");
  const tActions = useTranslations("App.Channels.Actions");
  const pathname = usePathname();
  const router = useRouter();
  const hasOrganization = Boolean(organizationId);
  const [roomRows, setRoomRows] = useState(() => applyRoomReadOverlays(rooms));
  const [archivedRows, setArchivedRows] = useState(archivedRooms);
  const [pendingRows, setPendingRows] = useState(pendingInvitations);
  const [prevRooms, setPrevRooms] = useState(rooms);
  const [prevArchivedRooms, setPrevArchivedRooms] = useState(archivedRooms);
  const [prevPendingInvitations, setPrevPendingInvitations] =
    useState(pendingInvitations);
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
    currentUserId.length > 0 ? (
      <LazyAblyProvider>
        <ChatMembershipRevokedListBridge currentUserId={currentUserId} />
      </LazyAblyProvider>
    ) : null;

  // Replace local list when RSC props change (full membership-visible set).
  if (rooms !== prevRooms) {
    setPrevRooms(rooms);
    setRoomRows(applyRoomReadOverlays(rooms));
  }
  if (archivedRooms !== prevArchivedRooms) {
    setPrevArchivedRooms(archivedRooms);
    setArchivedRows(archivedRooms);
  }
  if (pendingInvitations !== prevPendingInvitations) {
    setPrevPendingInvitations(pendingInvitations);
    setPendingRows(pendingInvitations);
  }

  useEffect(() => {
    let cancelled = false;

    const refreshRooms = async () => {
      const [activeResult, archivedResult, pendingResult] = await Promise.all([
        listOrganizationChatRoomsAction(),
        hasOrganization
          ? listOrganizationArchivedChatRoomsAction()
          : Promise.resolve({
              ok: true as const,
              value: {
                rooms: [] as ChatRoom[],
                nextCursor: null as string | null,
              },
            }),
        listPendingChatRoomInvitationsAction(),
      ]);
      if (cancelled) {
        return;
      }
      if (activeResult.ok) {
        setRoomRows(applyRoomReadOverlays(activeResult.value.rooms));
      }
      if (archivedResult.ok) {
        setArchivedRows(archivedResult.value.rooms);
      }
      if (pendingResult.ok) {
        setPendingRows(pendingResult.value);
      }
    };

    // Mobile sheet remounts the list with stale RSC props; refresh immediately
    // so overlays can drop once Core confirms the mark-read.
    void refreshRooms();

    const intervalId = window.setInterval(
      refreshRooms,
      ORGANIZATION_CHAT_POLL_MS,
    );
    window.addEventListener("focus", refreshRooms);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshRooms);
    };
  }, [hasOrganization, organizationId]);

  useEffect(() => {
    const handleRoomRead = (event: Event) => {
      const detail = (
        event as CustomEvent<{ room?: ChatRoom; roomId?: string }>
      ).detail;
      if (!detail?.roomId) {
        return;
      }

      if (detail.room) {
        // Dual-baseline: room mark-read may still leave unlooked threads.
        // Only sticky-clear when the server row is fully clear.
        applyRoomReadResultToOverlay(detail.room);
      }

      setRoomRows((current) =>
        applyRoomReadOverlays(
          current.map((room) =>
            room.id === detail.roomId
              ? (detail.room ?? {
                  ...room,
                  unreadCount: 0,
                  unreadMentionCount: 0,
                  markedUnread: false,
                })
              : room,
          ),
        ),
      );
    };

    window.addEventListener("organization-chat-room-read", handleRoomRead);
    return () => {
      window.removeEventListener("organization-chat-room-read", handleRoomRead);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const handleRoomsChanged = (event: Event) => {
      const detail = (event as CustomEvent<OrganizationChatRoomsChangedDetail>)
        .detail;
      const removedRoomId = detail?.removedRoomId;
      if (removedRoomId) {
        setRoomRows((current) =>
          applyRoomReadOverlays(
            current.filter((row) => row.id !== removedRoomId),
          ),
        );
        setArchivedRows((current) =>
          current.filter((row) => row.id !== removedRoomId),
        );
        return;
      }

      const room = detail?.room;
      if (room) {
        setRoomRows((current) => {
          const without = current.filter((row) => row.id !== room.id);
          return applyRoomReadOverlays([room, ...without]);
        });
        setArchivedRows((current) =>
          current.filter((row) => row.id !== room.id),
        );
        return;
      }

      void Promise.all([
        listOrganizationChatRoomsAction(),
        hasOrganization
          ? listOrganizationArchivedChatRoomsAction()
          : Promise.resolve({
              ok: true as const,
              value: {
                rooms: [] as ChatRoom[],
                nextCursor: null as string | null,
              },
            }),
        listPendingChatRoomInvitationsAction(),
      ]).then(([activeResult, archivedResult, pendingResult]) => {
        if (cancelled) {
          return;
        }
        if (activeResult.ok) {
          setRoomRows(applyRoomReadOverlays(activeResult.value.rooms));
        }
        if (archivedResult.ok) {
          setArchivedRows(archivedResult.value.rooms);
        }
        if (pendingResult.ok) {
          setPendingRows(pendingResult.value);
        }
      });
    };

    window.addEventListener(
      ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
      handleRoomsChanged,
    );
    return () => {
      cancelled = true;
      window.removeEventListener(
        ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
        handleRoomsChanged,
      );
    };
  }, [hasOrganization]);

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
      setArchivedRows((current) => current.filter((row) => row.id !== room.id));
      setRoomRows((current) => {
        const without = current.filter((row) => row.id !== result.value.id);
        return applyRoomReadOverlays([result.value, ...without]);
      });
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

  function handleRoomUpdated(updated: ChatRoom) {
    applyRoomReadResultToOverlay(updated);
    setRoomRows((current) =>
      applyRoomReadOverlays(
        current.map((room) => (room.id === updated.id ? updated : room)),
      ),
    );
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
        setRoomRows(applyRoomReadOverlays(roomsResult.value.rooms));
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
            <SectionHeader
              href="/?create=channel"
              isOpen={channelSectionOpen}
              label={t("createChannel")}
              secondaryAction={<BrowseChannelsDialog />}
              dismissSheetOnNavigate={dismissSheetOnNavigate}
            >
              {t("title")}
            </SectionHeader>
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
                    onRoomUpdated={handleRoomUpdated}
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
            <SectionHeader isOpen={externalOpen}>
              {tExternal("title")}
            </SectionHeader>
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
                    label={
                      room.kind === "direct"
                        ? getRoomDisplayName(room, currentUserId)
                        : room.name
                    }
                    subtitle={
                      room.kind !== "direct" &&
                      room.myAccess === "guest" &&
                      room.organizationName
                        ? tExternal("hostOrganization", {
                            organization: room.organizationName,
                          })
                        : undefined
                    }
                    isActive={activeRoomId === room.id}
                    leading={
                      room.kind === "direct" ? (
                        <DirectRoomAvatarStack
                          room={room}
                          currentUserId={currentUserId}
                          canOpenHumanDirect
                          selectedRoomId={activeRoomId}
                        />
                      ) : (
                        <ChannelDiscoverabilityIcon discoverability="external" />
                      )
                    }
                    onRoomUpdated={handleRoomUpdated}
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
            <SectionHeader isOpen={archivedSectionOpen}>
              {t("archivedChannels")}
            </SectionHeader>
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
            Sidebar rows = messaged history only. `+` opens Start New DM
            (`/?dm=new`): org members + coworkers (1:1 only). Personal
            workspace soft-gates named channels but still mounts the same draft
            with empty members (coworkers only).
          */}
          <SectionHeader
            href="/?dm=new"
            isOpen={directOpen}
            label={t("Draft.title")}
            dismissSheetOnNavigate={dismissSheetOnNavigate}
          >
            {t("directMessages")}
          </SectionHeader>
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
                  onRoomUpdated={handleRoomUpdated}
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
