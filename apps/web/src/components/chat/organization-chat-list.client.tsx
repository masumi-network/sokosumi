"use client";

import {
  ChevronDown,
  Ellipsis,
  MessageCircle,
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
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { deleteRoomAction, restoreRoomAction } from "@/app/chat/actions";
import { BrowseChannelsDialog } from "@/app/chat/components/browse-channels-dialog";
import {
  getDirectRoomParticipants,
  getRoomDisplayName,
} from "@/app/chat/components/room-helpers";
import { PresenceDot } from "@/components/chat/presence-dot";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { useChatUnreadDocumentTitle } from "@/hooks/use-chat-unread-document-title";
import type { ChatRoom, ChatRoomPresence } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";
import { ChannelDiscoverabilityIcon } from "./channel-discoverability-icon";
import { compareChatRoomsByRecentActivity } from "./chat-room-activity-sort";
import { ChatRoomSidebarRow } from "./chat-room-sidebar-row";
import { countChatRoomsWithUnreadAttention } from "./chat-unread-document-title";
import { ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT } from "./organization-chat-events";
import {
  listOrganizationArchivedChatRoomsAction,
  listOrganizationChatRoomsAction,
  loadMoreOrganizationArchivedChatRoomsAction,
  loadMoreOrganizationChatRoomsAction,
} from "./organization-chat-list.actions";
import {
  applyRoomReadOverlays,
  applyRoomReadResultToOverlay,
} from "./room-read-overlay";

const ORGANIZATION_CHAT_POLL_MS = 15_000;

/** Upsert first-page rooms; keep older rows previously appended via load-more. */
function upsertFirstPageRooms(
  firstPage: ChatRoom[],
  existing: ChatRoom[],
): ChatRoom[] {
  const firstPageIds = new Set(firstPage.map((room) => room.id));
  const older = existing.filter((room) => !firstPageIds.has(room.id));
  return [...firstPage, ...older];
}

function appendUniqueRooms(
  existing: ChatRoom[],
  incoming: ChatRoom[],
): ChatRoom[] {
  const existingIds = new Set(existing.map((room) => room.id));
  const unique = incoming.filter((room) => !existingIds.has(room.id));
  return [...existing, ...unique];
}

/** Same absolute slot as live room rows so archived height matches Channels/DMs. */
const ARCHIVED_TRAILING_CONTROL_CLASS =
  "absolute top-1/2 right-1 z-10 flex size-7 -translate-y-1/2 items-center justify-center";

interface OrganizationChatListProps {
  rooms: ChatRoom[];
  roomsNextCursor: string | null;
  archivedRooms: ChatRoom[];
  archivedRoomsNextCursor: string | null;
  currentUserId: string;
  organizationId: string | null;
  canDeleteArchivedRooms?: boolean;
  /**
   * Wrap room/section links in Radix `SheetClose` (sidebar Sheet).
   * Set false when the list is page-mounted outside a Sheet.
   */
  dismissSheetOnNavigate?: boolean;
}

function presenceLabel(
  t: ReturnType<typeof useTranslations<"App.Channels">>,
  presence: ChatRoomPresence,
) {
  if (presence === "online") {
    return t("Presence.online");
  }

  if (presence === "afk") {
    return t("Presence.afk");
  }

  return t("Presence.offline");
}

function DirectAvatarStack({
  room,
  currentUserId,
}: {
  room: ChatRoom;
  currentUserId: string;
}) {
  const t = useTranslations("App.Channels");
  const participants = getDirectRoomParticipants(room, currentUserId).slice(
    0,
    3,
  );

  if (participants.length === 0) {
    return (
      <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-medium">
        <MessageCircle className="size-3" aria-hidden />
      </span>
    );
  }

  return (
    <span className="inline-flex h-5 shrink-0 items-center">
      {participants.map((participant, index) => (
        <span
          className={cn("relative block", index > 0 && "-ml-2")}
          key={participant.id}
          title={participant.name}
        >
          <Avatar className="border-sidebar-background size-5 border">
            <AvatarImage
              alt={participant.name}
              src={participant.image ?? undefined}
            />
            <AvatarFallback className="text-[0.5625rem] font-medium">
              {getInitials(participant.name)}
            </AvatarFallback>
          </Avatar>
          <PresenceDot
            className="-right-0.5 -bottom-0.5 absolute size-2"
            label={presenceLabel(t, participant.presence)}
            presence={participant.presence}
          />
        </span>
      ))}
    </span>
  );
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
  const hasTrailing = Boolean(secondaryAction) || Boolean(href && label);
  const trailingCount = (secondaryAction ? 1 : 0) + (href && label ? 1 : 0);

  const createLink =
    href && label ? (
      <Link
        aria-label={label}
        className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground relative flex size-7 items-center justify-center rounded-md transition-colors before:absolute before:-inset-2 before:content-[''] sm:before:hidden"
        href={href}
      >
        <Plus className="size-4 md:size-3.5" aria-hidden />
      </Link>
    ) : null;

  return (
    <div className="group-data-[collapsible=icon]:hidden relative flex h-10 items-center gap-1 px-3 md:h-8">
      <CollapsibleTrigger
        className={cn(
          "text-muted-foreground hover:text-foreground flex min-w-0 flex-1 items-center gap-1 rounded-md text-left text-base font-medium transition-colors md:text-xs",
          trailingCount === 1 && "pr-8",
          trailingCount >= 2 && "pr-14",
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

export function OrganizationChatList({
  rooms,
  roomsNextCursor,
  archivedRooms,
  archivedRoomsNextCursor,
  currentUserId,
  organizationId,
  canDeleteArchivedRooms = false,
  dismissSheetOnNavigate = true,
}: OrganizationChatListProps) {
  const t = useTranslations("App.Channels");
  const tActions = useTranslations("App.Channels.Actions");
  const pathname = usePathname();
  const router = useRouter();
  const hasOrganization = Boolean(organizationId);
  const [roomRows, setRoomRows] = useState(() => applyRoomReadOverlays(rooms));
  const [archivedRows, setArchivedRows] = useState(archivedRooms);
  const [activeNextCursor, setActiveNextCursor] = useState(roomsNextCursor);
  const [archivedNextCursor, setArchivedNextCursor] = useState(
    archivedRoomsNextCursor,
  );
  const [prevRooms, setPrevRooms] = useState(rooms);
  const [prevRoomsNextCursor, setPrevRoomsNextCursor] =
    useState(roomsNextCursor);
  const [prevArchivedRooms, setPrevArchivedRooms] = useState(archivedRooms);
  const [prevArchivedRoomsNextCursor, setPrevArchivedRoomsNextCursor] =
    useState(archivedRoomsNextCursor);
  const [channelSectionOpen, setChannelSectionOpen] = useState(true);
  const [archivedSectionOpen, setArchivedSectionOpen] = useState(false);
  const [directOpen, setDirectOpen] = useState(true);
  const [restoringRoomId, setRestoringRoomId] = useState<string | null>(null);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const [pendingDeleteRoom, setPendingDeleteRoom] = useState<ChatRoom | null>(
    null,
  );
  const [_isRestoring, startRestoreTransition] = useTransition();
  const [_isDeleting, startDeleteTransition] = useTransition();
  const [isLoadingMoreActive, startLoadMoreActiveTransition] = useTransition();
  const [isLoadingMoreArchived, startLoadMoreArchivedTransition] =
    useTransition();
  const hasAppendedActiveRef = useRef(false);
  const hasAppendedArchivedRef = useRef(false);
  const activeRoomId = getActiveRoomIdFromPathname(pathname);
  const unreadRoomCount = countChatRoomsWithUnreadAttention(roomRows, {
    activeRoomId,
  });
  useChatUnreadDocumentTitle(unreadRoomCount);

  // Adjust local list when RSC props change (no Effect — keep load-more history).
  if (rooms !== prevRooms || roomsNextCursor !== prevRoomsNextCursor) {
    setPrevRooms(rooms);
    setPrevRoomsNextCursor(roomsNextCursor);
    setRoomRows(applyRoomReadOverlays(upsertFirstPageRooms(rooms, roomRows)));
    if (!hasAppendedActiveRef.current) {
      setActiveNextCursor(roomsNextCursor);
    }
  }
  if (
    archivedRooms !== prevArchivedRooms ||
    archivedRoomsNextCursor !== prevArchivedRoomsNextCursor
  ) {
    setPrevArchivedRooms(archivedRooms);
    setPrevArchivedRoomsNextCursor(archivedRoomsNextCursor);
    setArchivedRows(upsertFirstPageRooms(archivedRooms, archivedRows));
    if (!hasAppendedArchivedRef.current) {
      setArchivedNextCursor(archivedRoomsNextCursor);
    }
  }

  useEffect(() => {
    let cancelled = false;

    const refreshRooms = async () => {
      const [activeResult, archivedResult] = await Promise.all([
        listOrganizationChatRoomsAction(),
        hasOrganization
          ? listOrganizationArchivedChatRoomsAction()
          : Promise.resolve({
              ok: true as const,
              data: [] as ChatRoom[],
              nextCursor: null as string | null,
            }),
      ]);
      if (cancelled) {
        return;
      }
      if (activeResult.ok) {
        setRoomRows((current) =>
          applyRoomReadOverlays(
            upsertFirstPageRooms(activeResult.data, current),
          ),
        );
        setActiveNextCursor((prev) =>
          hasAppendedActiveRef.current ? prev : activeResult.nextCursor,
        );
      }
      if (archivedResult.ok) {
        setArchivedRows((current) =>
          upsertFirstPageRooms(archivedResult.data, current),
        );
        setArchivedNextCursor((prev) =>
          hasAppendedArchivedRef.current ? prev : archivedResult.nextCursor,
        );
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
      const detail = (event as CustomEvent<{ room?: ChatRoom }>).detail;
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
              data: [] as ChatRoom[],
              nextCursor: null as string | null,
            }),
      ]).then(([activeResult, archivedResult]) => {
        if (cancelled) {
          return;
        }
        if (activeResult.ok) {
          setRoomRows((current) =>
            applyRoomReadOverlays(
              upsertFirstPageRooms(activeResult.data, current),
            ),
          );
          setActiveNextCursor((prev) =>
            hasAppendedActiveRef.current ? prev : activeResult.nextCursor,
          );
        }
        if (archivedResult.ok) {
          setArchivedRows((current) =>
            upsertFirstPageRooms(archivedResult.data, current),
          );
          setArchivedNextCursor((prev) =>
            hasAppendedArchivedRef.current ? prev : archivedResult.nextCursor,
          );
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
        toast.error(result.message);
        return;
      }
      toast.success(tActions("restoreSuccess", { name: room.name }));
      setArchivedRows((current) => current.filter((row) => row.id !== room.id));
      setRoomRows((current) => {
        const without = current.filter((row) => row.id !== result.data.id);
        return applyRoomReadOverlays([result.data, ...without]);
      });
      router.push(`/chat/rooms/${result.data.id}`);
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
        toast.error(result.message || tActions("deleteError"));
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

  function handleLoadMoreActiveRooms() {
    if (!activeNextCursor || isLoadingMoreActive) {
      return;
    }
    const cursor = activeNextCursor;
    startLoadMoreActiveTransition(async () => {
      const result = await loadMoreOrganizationChatRoomsAction(cursor);
      if (!result.ok) {
        toast.error(t("loadMoreError"));
        return;
      }
      hasAppendedActiveRef.current = true;
      setRoomRows((current) =>
        applyRoomReadOverlays(appendUniqueRooms(current, result.data)),
      );
      setActiveNextCursor(result.nextCursor);
    });
  }

  function handleLoadMoreArchivedRooms() {
    if (!archivedNextCursor || isLoadingMoreArchived) {
      return;
    }
    const cursor = archivedNextCursor;
    startLoadMoreArchivedTransition(async () => {
      const result = await loadMoreOrganizationArchivedChatRoomsAction(cursor);
      if (!result.ok) {
        toast.error(t("loadMoreError"));
        return;
      }
      hasAppendedArchivedRef.current = true;
      setArchivedRows((current) => appendUniqueRooms(current, result.data));
      setArchivedNextCursor(result.nextCursor);
    });
  }

  const { directMessages, namedChannels } = useMemo(() => {
    const directMessages: ChatRoom[] = [];
    const namedChannels: ChatRoom[] = [];

    for (const room of roomRows) {
      if (room.kind === "channel") {
        namedChannels.push(room);
        continue;
      }

      if (room.kind === "direct") {
        directMessages.push(room);
      }
    }

    // Unmuted → pinned → public → private → muted; activity within bucket.
    namedChannels.sort(compareChatRoomsByRecentActivity);
    directMessages.sort(compareChatRoomsByRecentActivity);

    return { directMessages, namedChannels };
  }, [roomRows]);

  const sortedArchivedChannels = useMemo(() => {
    return [...archivedRows].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }, [archivedRows]);

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent className="space-y-2">
        <Collapsible
          open={channelSectionOpen}
          onOpenChange={setChannelSectionOpen}
        >
          <SectionHeader
            href={hasOrganization ? "/chat?create=channel" : undefined}
            isOpen={channelSectionOpen}
            label={t("createChannel")}
            secondaryAction={
              hasOrganization ? <BrowseChannelsDialog /> : undefined
            }
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
                    {hasOrganization
                      ? t("Empty.noChannels")
                      : t("Empty.onlyInOrganizations")}
                  </div>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </CollapsibleContent>
        </Collapsible>

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
                        <span className="size-7 shrink-0" aria-hidden />
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
                                  "size-4",
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
                {archivedNextCursor ? (
                  <SidebarMenuItem>
                    <div className="group-data-[collapsible=icon]:hidden px-3 py-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground w-full text-xs"
                        disabled={isLoadingMoreArchived}
                        onClick={handleLoadMoreArchivedRooms}
                      >
                        {isLoadingMoreArchived ? t("loading") : t("loadMore")}
                      </Button>
                    </div>
                  </SidebarMenuItem>
                ) : null}
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
            (`/chat?dm=new`): org members + coworkers (1:1 only). Personal
            workspace soft-gates named channels but still mounts the same draft
            with empty members (coworkers only).
          */}
          <SectionHeader
            href="/chat?dm=new"
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
                    <DirectAvatarStack
                      room={room}
                      currentUserId={currentUserId}
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

        {activeNextCursor ? (
          <div className="group-data-[collapsible=icon]:hidden px-3 py-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-muted-foreground hover:text-foreground w-full text-xs"
              disabled={isLoadingMoreActive}
              onClick={handleLoadMoreActiveRooms}
            >
              {isLoadingMoreActive ? t("loading") : t("loadMore")}
            </Button>
          </div>
        ) : null}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
