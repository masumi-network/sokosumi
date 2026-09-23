"use client";

import {
  Archive,
  ArrowUpDown,
  Building2,
  Check,
  CheckCheck,
  Ellipsis,
  Globe2,
  Hash,
  MessageCircle,
  Pin,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  AnimatePresence,
  MotionConfig,
  type MotionProps,
  motion,
  type Transition,
  useReducedMotion,
} from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState, useTransition } from "react";
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
import { useRoomSelection } from "@/app/chat/components/room-cache-provider";
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
import { Collapsible } from "@/components/ui/collapsible";
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
  SidebarRowSlot,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  SIDEBAR_ROW_CLASS,
  SIDEBAR_ROW_LABEL_INSET_CLASS,
} from "@/components/ui/sidebar-classes";
import type {
  ChatRoom,
  ChatRoomInvitation,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import {
  getActiveRoomIdFromPathname,
  getActiveRoomIdFromSelection,
} from "./active-room-id";
import { ChannelKindGlyph } from "./channel-discoverability-icon";
import { ChannelRoomMark } from "./channel-room-mark";
import {
  ChatRoomSidebarRow,
  type ChatRoomSidebarRowProps,
} from "./chat-room-sidebar-row";
import {
  ChatSidebarSectionContent,
  ChatSidebarSectionHeader,
} from "./chat-sidebar-section-header";
import { ChatUnreadNavRows } from "./chat-unread-nav-rows";
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
import { resolveSectionAttention, roomUnreadReads } from "./room-attention";
import { beginRoomAttentionRefresh } from "./room-read-overlay";
import {
  advanceUnreadFilterPass,
  EMPTY_UNREAD_FILTER_PASS,
} from "./unread-filter-pass";
import { useOrganizationChatRooms } from "./use-organization-chat-rooms";

/** Stable empty default — inline `= []` is a new array every render and
 *  infinite-loops the render-time pendingInvitations sync (React #301). */
const EMPTY_PENDING_INVITATIONS: ChatRoomInvitation[] = [];

/** Same absolute slot as live room rows so archived height matches Channels/DMs. */
const ARCHIVED_TRAILING_CONTROL_CLASS =
  "absolute top-1/2 right-1 z-10 flex size-8 -translate-y-1/2 items-center justify-center after:absolute after:-inset-1.5 md:size-7 md:after:hidden";

/**
 * A room the All unreads filter lists with nothing unread: read during the
 * pass, or pinned. Dimmed.
 */
/**
 * One timing for everything the All unreads filter animates: motion's
 * presence, and the same curve and length for its CSS dim and fade.
 */
const UNREAD_FILTER_TRANSITION: Transition = {
  duration: 0.2,
  ease: [0.2, 0, 0, 1],
};
const UNREAD_FILTER_CSS_TIMING =
  "motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.2,0,0,1)]";

const READ_INBOX_ROOM_ITEM_PROPS = {
  "data-read": "true",
  // Eases down when the reader moves on from a room they just read. Coming
  // back to full is instant: that is new activity, and it should be seen.
  className: `opacity-60 motion-safe:transition-opacity ${UNREAD_FILTER_CSS_TIMING}`,
};

/**
 * The caught-up row and its "Read just now" label, in and out. Height, so
 * what is below slides instead of jumping, and at the same timing as a room
 * arriving, so a room taking the caught-up row's place nets out to no move.
 */
const UNREAD_FILTER_PRESENCE = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  style: { overflow: "hidden" },
} satisfies MotionProps;

/**
 * A room arriving in or leaving the filter's list. No opacity: a read room's
 * dimming is a class on the same `<li>`, and a finished fade would pin it at
 * full. Clipped only while it moves, because the collapsed rail's attention
 * pill sits outside the row's box.
 */
const UNREAD_FILTER_ROW_PRESENCE = {
  initial: { height: 0, overflow: "hidden" },
  animate: { height: "auto", transitionEnd: { overflow: "visible" } },
  exit: { height: 0, overflow: "hidden" },
} satisfies MotionProps;

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
  const selectedPath = useRoomSelection();
  const router = useRouter();
  const { setOpen } = useSidebar();
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
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [filterSwitched, setFilterSwitched] = useState(false);
  const reduceMotion = useReducedMotion();

  function handleUnreadOnlyChange(next: boolean) {
    setFilterSwitched(true);
    setUnreadOnly(next);
  }
  const [filterPass, setFilterPass] = useState(EMPTY_UNREAD_FILTER_PASS);
  // The app sidebar and the mobile `/chat` page each mount this list.
  const inboxReadLabelId = useId();
  const inboxPinnedLabelId = useId();
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

  // The highlight moves on click, before the route commits. Dim follows
  // that, or a read room stays faded under the bar until pathname catches up.
  const activeRoomId = selectedPath
    ? getActiveRoomIdFromSelection(selectedPath)
    : getActiveRoomIdFromPathname(pathname);
  // All unreads (SOK-1159): the rooms a read would still change, newest
  // activity first. One answer for what the filter lists and whether the
  // reader is caught up, so the two cannot disagree.
  const unreadRooms = useMemo(
    () =>
      roomRows
        .filter((room) => {
          const { readRoom, lookThreads } = roomUnreadReads(room);
          return readRoom || lookThreads;
        })
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() ||
            a.id.localeCompare(b.id),
        ),
    [roomRows],
  );
  const { pinned, directMessages, namedChannels, externalJoined } = useMemo(
    () => partitionRoomsForSidebar(roomRows),
    [roomRows],
  );
  // The filter is one flat list with Pinned under it, not the sections: a
  // heading over one or two rooms is noise. Pinned stays last, so the
  // caught-up message leads and nothing moves when the reader gets there.
  // Pinned holds every pinned room, fixed, in the reader's own order, so
  // reaching one never means switching the filter off; the flat list never
  // takes a pinned room, so none shows twice or moves out of Pinned when it
  // is opened or turns unread. In the flat list each room keeps the place it
  // first took in the pass and dims there once read. Switching the filter
  // off ends the pass.
  const pinnedIds = new Set(pinned.map((room) => room.id));
  const nextFilterPass = unreadOnly
    ? advanceUnreadFilterPass(filterPass, {
        unreadIds: unreadRooms
          .filter((room) => !pinnedIds.has(room.id))
          .map((room) => room.id),
      })
    : EMPTY_UNREAD_FILTER_PASS;
  if (nextFilterPass !== filterPass) {
    setFilterPass(nextFilterPass);
  }
  const inboxRooms = unreadOnly
    ? [
        ...nextFilterPass.seen,
        // The open room is listed while it is open, read or not.
        ...(activeRoomId && !nextFilterPass.seen.includes(activeRoomId)
          ? [activeRoomId]
          : []),
      ]
        // A room pinned during the pass leaves this list. `seen` keeps its
        // place, so unpinning puts it back where it was.
        .filter((id) => !pinnedIds.has(id))
        .flatMap((id) => roomRows.find((row) => row.id === id) ?? [])
    : [];
  const inboxPinnedRooms = unreadOnly ? pinned : [];
  const isUnreadRoom = (room: ChatRoom) =>
    unreadRooms.some((row) => row.id === room.id);
  // Read rooms dim, but not the open one: dimmed, its highlight reads as
  // disabled.
  const inboxItemProps = (room: ChatRoom) =>
    isUnreadRoom(room) || room.id === activeRoomId
      ? undefined
      : READ_INBOX_ROOM_ITEM_PROPS;
  const pinnedRoomIds = pinned.map((room) => room.id);
  // Reordering lives on the full Pinned section's header, which the filter
  // replaces; its Pinned group shows every pin, fixed.
  const canReorderPinned = pinnedOpen && pinned.length > 1 && !unreadOnly;
  // A pending invitation stays under the filter, in External, and keeps the
  // reader from being caught up: it is addressed to them and waits on them,
  // which is why a closed section already marks it as a mention
  // (`resolveSectionAttention`). Caught up is about what is unread, not what
  // is listed: pinned rooms and rooms read in the pass stay listed, dimmed.
  const caughtUp =
    unreadOnly && unreadRooms.length === 0 && pendingRows.length === 0;
  const showsReadLabel = caughtUp && inboxRooms.length > 0;
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
      <MotionConfig
        transition={reduceMotion ? { duration: 0 } : UNREAD_FILTER_TRANSITION}
      >
        <SidebarGroupContent className="space-y-2">
          <ChatUnreadNavRows
            rooms={roomRows}
            currentUserId={currentUserId}
            dismissSheetOnNavigate={dismissSheetOnNavigate}
            unreadOnly={unreadOnly}
            onUnreadOnlyChange={handleUnreadOnlyChange}
          />
          {/* One list per mode, so switching fades the new one in instead of
            swapping rows under the pointer. Not on first render: the sidebar
            does not fade in on every load. */}
          <div
            key={unreadOnly ? "unread" : "all"}
            className={cn(
              "space-y-2",
              filterSwitched &&
                `motion-safe:animate-in motion-safe:fade-in ${UNREAD_FILTER_CSS_TIMING}`,
            )}
          >
            {unreadOnly ? (
              // Present for the whole pass, empty or not, so a room arriving in an
              // empty list animates in: `initial={false}` only spares the rows
              // already here when the filter comes on. Hidden while it holds
              // nothing, so it adds no gap. On the rail the caught-up row is
              // hidden, so there only a room keeps it.
              <div className="[&:not(:has(li,[role=status]))]:hidden group-data-[collapsible=icon]:[&:not(:has(li))]:hidden">
                <AnimatePresence initial={false}>
                  {caughtUp ? (
                    // A message, not a row: nothing here opens. The way back to
                    // every room is the tinted All unreads row right above it. Row
                    // sized, so a room arriving takes its place and nothing below
                    // moves.
                    <motion.div
                      key="caught-up"
                      role="status"
                      data-slot="unread-caught-up"
                      className="group-data-[collapsible=icon]:hidden"
                      {...UNREAD_FILTER_PRESENCE}
                    >
                      <div className={cn(SIDEBAR_ROW_CLASS, "text-sm")}>
                        <SidebarRowSlot>
                          <span className="bg-primary-quaternary text-primary-variant grid size-5 place-items-center rounded-full">
                            <CheckCheck className="size-3" aria-hidden />
                          </span>
                        </SidebarRowSlot>
                        <span className="text-foreground min-w-0 truncate font-medium">
                          {t("UnreadNav.caughtUp")}
                        </span>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
                <AnimatePresence initial={false}>
                  {showsReadLabel ? (
                    // Everything left is read: say why it is still listed.
                    <motion.div
                      key="read-label"
                      className="group-data-[collapsible=icon]:hidden"
                      {...UNREAD_FILTER_PRESENCE}
                    >
                      <p
                        id={inboxReadLabelId}
                        className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium"
                      >
                        {t("UnreadNav.justRead")}
                      </p>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
                <SidebarMenu
                  data-slot="unread-inbox"
                  aria-labelledby={
                    showsReadLabel ? inboxReadLabelId : undefined
                  }
                  className="gap-0"
                >
                  <AnimatePresence initial={false}>
                    {inboxRooms.map((room) => (
                      <ChatRoomSidebarRow
                        key={room.id}
                        {...roomRowProps(room)}
                        itemProps={inboxItemProps(room)}
                        itemMotion={UNREAD_FILTER_ROW_PRESENCE}
                      />
                    ))}
                  </AnimatePresence>
                </SidebarMenu>
              </div>
            ) : null}
            {!unreadOnly && pinned.length > 0 ? (
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
                        onClick={() =>
                          setPinnedReorderMode((current) => !current)
                        }
                      >
                        {isReorderingPinned ? (
                          <Check className="size-4 md:size-3.5" aria-hidden />
                        ) : (
                          <ArrowUpDown
                            className="size-4 md:size-3.5"
                            aria-hidden
                          />
                        )}
                      </button>
                    ) : undefined
                  }
                >
                  {t("pinned")}
                </ChatSidebarSectionHeader>
                {/* A row being dragged translates past the section's box, and the
                animation's `overflow-hidden` would cut it off. Dropping the
                clip cannot cost the section its animation, because
                `canReorderPinned` carries `pinnedOpen`: the render that
                closes Pinned is already the render where `isReorderingPinned`
                reads false, so the collapse clips as every other section
                does. */}
                <ChatSidebarSectionContent
                  className={cn(isReorderingPinned && "overflow-visible")}
                >
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
                        <ChatRoomSidebarRow
                          key={room.id}
                          {...roomRowProps(room)}
                        />
                      ))}
                    </SidebarMenu>
                  )}
                </ChatSidebarSectionContent>
              </Collapsible>
            ) : null}

            {hasOrganization && !unreadOnly ? (
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
                <ChatSidebarSectionContent>
                  <SidebarMenu className="gap-0">
                    {namedChannels.map((room) => (
                      <ChatRoomSidebarRow
                        key={room.id}
                        {...roomRowProps(room)}
                      />
                    ))}
                    {namedChannels.length === 0 ? (
                      <SidebarMenuItem>
                        <div
                          className={cn(
                            SIDEBAR_ROW_LABEL_INSET_CLASS,
                            "text-muted-foreground group-data-[collapsible=icon]:hidden py-1.5 pr-2 text-xs",
                          )}
                        >
                          {t("Empty.noChannels")}
                        </div>
                      </SidebarMenuItem>
                    ) : null}
                  </SidebarMenu>
                </ChatSidebarSectionContent>
              </Collapsible>
            ) : null}

            {pendingRows.length > 0 ||
            (!unreadOnly && externalJoined.length > 0) ? (
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
                <ChatSidebarSectionContent>
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
                            className="text-tertiary-foreground dark:text-muted-foreground group-data-[collapsible=icon]:hidden flex w-full items-start gap-2 px-2 py-1.5"
                          >
                            <SidebarRowSlot>
                              <Globe2
                                className="text-muted-foreground size-4"
                                aria-hidden
                              />
                            </SidebarRowSlot>
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
                                  onClick={() =>
                                    handleAcceptInvitation(invitation)
                                  }
                                >
                                  {acceptBusy
                                    ? t("loading")
                                    : tExternal("accept")}
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
                    {/* Under the filter these rooms are in its flat list. */}
                    {unreadOnly
                      ? null
                      : externalJoined.map((room) => (
                          <ChatRoomSidebarRow
                            key={room.id}
                            {...roomRowProps(room)}
                          />
                        ))}
                  </SidebarMenu>
                </ChatSidebarSectionContent>
              </Collapsible>
            ) : null}

            {/* After External: a pending invitation waits on the reader, as an
            unread room does. */}
            {inboxPinnedRooms.length > 0 ? (
              <div>
                <p
                  id={inboxPinnedLabelId}
                  className="text-muted-foreground group-data-[collapsible=icon]:hidden px-2 pb-1 text-xs font-medium"
                >
                  {t("pinned")}
                </p>
                <SidebarMenu
                  data-slot="unread-inbox-pinned"
                  aria-labelledby={inboxPinnedLabelId}
                  className="gap-0"
                >
                  {inboxPinnedRooms.map((room) => (
                    <ChatRoomSidebarRow
                      key={room.id}
                      {...roomRowProps(room)}
                      itemProps={inboxItemProps(room)}
                    />
                  ))}
                </SidebarMenu>
              </div>
            ) : null}
            {hasOrganization &&
            !unreadOnly &&
            sortedArchivedChannels.length > 0 ? (
              <Collapsible
                open={archivedSectionOpen}
                onOpenChange={setArchivedSectionOpen}
              >
                {/*
              Archived keeps its square on the rail so nothing under it — the
              Direct Messages section — moves when the sidebar toggles. Its
              rows do not follow it there: they are static, and Restore and
              Delete live in a menu a 32px square has no room for (Rail
              actions, CONTEXT.md). So the square expands the sidebar and
              opens the section, the way a pending invitation's tile expands
              to its Accept and Decline.
            */}
                <ChatSidebarSectionHeader
                  isOpen={archivedSectionOpen}
                  railIcon={Archive}
                  onRailPress={() => {
                    setArchivedSectionOpen(true);
                    setOpen(true);
                  }}
                >
                  {t("archivedChannels")}
                </ChatSidebarSectionHeader>
                <ChatSidebarSectionContent>
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
                          <div
                            className={cn(
                              SIDEBAR_ROW_CLASS,
                              "text-tertiary-foreground dark:text-muted-foreground group-data-[collapsible=icon]:hidden",
                            )}
                          >
                            <SidebarRowSlot>
                              <ChannelKindGlyph
                                className="opacity-60"
                                discoverability={room.discoverability}
                              />
                            </SidebarRowSlot>
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
                                      : "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/room-row:opacity-100 [@media(hover:hover)]:group-hover/room-row:opacity-100 data-[state=open]:opacity-100",
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
                                  : "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/room-row:opacity-100 [@media(hover:hover)]:group-hover/room-row:opacity-100",
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
                </ChatSidebarSectionContent>
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

            {!unreadOnly ? (
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
                <ChatSidebarSectionContent>
                  <SidebarMenu className="gap-0">
                    {directMessages.map((room) => (
                      <ChatRoomSidebarRow
                        key={room.id}
                        {...roomRowProps(room)}
                      />
                    ))}
                    {directMessages.length === 0 ? (
                      <SidebarMenuItem>
                        <div
                          className={cn(
                            SIDEBAR_ROW_LABEL_INSET_CLASS,
                            "text-muted-foreground group-data-[collapsible=icon]:hidden py-1.5 pr-2 text-xs",
                          )}
                        >
                          {t("Empty.noDirectMessages")}
                        </div>
                      </SidebarMenuItem>
                    ) : null}
                  </SidebarMenu>
                </ChatSidebarSectionContent>
              </Collapsible>
            ) : null}
          </div>
        </SidebarGroupContent>
      </MotionConfig>
    </SidebarGroup>
  );
}
