"use client";

import type {
  ChatRoom,
  ChatRoomInvitation,
  StarredChatRoomOrder,
} from "@sokosumi/core-client";
import { ArrowUpDown, Check } from "lucide-react";
import { MotionConfig, type Transition, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BrowseChannelsDialog } from "@/app/chat/components/browse-channels-dialog";
import { CreateChannelDialog } from "@/app/chat/components/create-channel-dialog";
import { CreateDirectDialog } from "@/app/chat/components/create-direct-dialog";
import { useRoomSelection } from "@/app/chat/components/room-cache-provider";
import {
  useRoomDisplayName,
  useRoomWorkspaceName,
} from "@/app/chat/components/use-room-display-name";
import { canManageChannelSettings } from "@/app/chat/utils/channel-member-permissions";
import { Collapsible } from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { SIDEBAR_ICON_ACTION_CLASS } from "@/components/ui/sidebar-classes";
import { SidebarSectionContent } from "@/components/ui/sidebar-section";
import { cn } from "@/lib/utils";
import { moveIdToSlot } from "@/lib/utils/move-id";
import {
  getActiveRoomIdFromPathname,
  getActiveRoomIdFromSelection,
} from "./active-room-id";
import { ArchivedChatSection } from "./archived-chat-section";
import { ChannelKindGlyph } from "./channel-discoverability-icon";
import { ChatElsewhereOverflowRow } from "./chat-elsewhere-overflow-row";
import {
  ChatRoomSidebarRow,
  type ChatRoomSidebarRowProps,
} from "./chat-room-sidebar-row";
import { ChatSidebarSectionHeader } from "./chat-sidebar-section-header";
import {
  ChatUnreadInbox,
  groupUnreadInbox,
  UnreadPinnedRooms,
} from "./chat-unread-inbox";
import {
  ChatMarkAllReadButton,
  ChatUnreadNavRows,
  ChatUnreadsFilterChip,
} from "./chat-unread-nav-rows";
import { DirectRoomAvatarStack } from "./direct-room-avatar-stack";
import {
  ExternalChatSection,
  useChatInvitationResponses,
} from "./external-chat-section";
import {
  listOrganizationChatRoomsAction,
  reorderPinnedOrganizationChatRoomsAction,
} from "./organization-chat-list.actions";
import { partitionRoomsForSidebar } from "./partition-rooms-for-sidebar";
import {
  PinnedRoomsDndContext,
  SortablePinnedRoomRow,
} from "./pinned-rooms-dnd";
import { rememberPinnedRooms } from "./remembered-pinned-rooms";
import {
  resolveChatsAttention,
  resolveSectionAttention,
  roomHasUnread,
} from "./room-attention";
import { beginRoomAttentionRefresh } from "./room-read-overlay";
import { selectElsewhereRows } from "./select-elsewhere-rows";
import {
  SidebarChatContext,
  sidebarChatAttention,
} from "./sidebar-chat-entries";
import { SidebarRoomSection } from "./sidebar-room-section";
import {
  advanceUnreadFilterPass,
  EMPTY_UNREAD_FILTER_PASS,
} from "./unread-filter-pass";
import { useChatUnreadsFilter } from "./use-chat-unreads-filter";
import { useOrganizationChatRooms } from "./use-organization-chat-rooms";
import { useOtherWorkspaceRooms } from "./use-other-workspace-rooms";

/** Stable empty default — inline `= []` is a new array every render and
 *  infinite-loops the render-time pendingInvitations sync (React #301). */
const EMPTY_PENDING_INVITATIONS: ChatRoomInvitation[] = [];

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

/**
 * A room the All unreads filter lists with nothing unread: read during the
 * pass, or pinned. Dimmed.
 */
const READ_INBOX_ROOM_ITEM_PROPS = {
  "data-read": "true",
  // Eases down when the reader moves on from a room they just read. Coming
  // back to full is instant: that is new activity, and it should be seen.
  className: `opacity-60 motion-safe:transition-opacity ${UNREAD_FILTER_CSS_TIMING}`,
};

interface OrganizationChatListProps {
  children?: ReactNode;
  rooms: ChatRoom[];
  archivedRooms: ChatRoom[];
  pendingInvitations?: ChatRoomInvitation[];
  currentUserId: string;
  organizationId: string | null;
  /** Caller is an owner or admin of the active organization. */
  isOrgOwnerOrAdmin?: boolean;
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
  /**
   * Head the list with Chats, as the nav groups are headed: the heading folds
   * the whole chat area and carries the Unreads chip. The sidebar does; the
   * phone's Chats page is titled Chats already, so its Catch up row keeps the
   * chip instead.
   */
  withChatsHeading?: boolean;
}

export function OrganizationChatList({
  children,
  rooms,
  archivedRooms,
  pendingInvitations = EMPTY_PENDING_INVITATIONS,
  currentUserId,
  organizationId,
  isOrgOwnerOrAdmin = false,
  dismissSheetOnNavigate = true,
  paintOnly = false,
  withChatsHeading = false,
}: OrganizationChatListProps) {
  const t = useTranslations("App.Channels");
  const roomDisplayName = useRoomDisplayName();
  const tExternal = useTranslations("App.Channels.External");
  const tActions = useTranslations("App.Channels.Actions");
  const roomWorkspaceName = useRoomWorkspaceName();
  const pathname = usePathname();
  const selectedPath = useRoomSelection();
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
  const invitationResponses = useChatInvitationResponses({
    pendingRows,
    setPendingRows,
    replaceAllRooms,
  });
  // In memory only, as the nav groups' are: the area comes back on reload.
  const [chatsOpen, setChatsOpen] = useState(true);
  // Folding a section survives a switch to Unreads and a move between groups.
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [directOpen, setDirectOpen] = useState(true);
  const [externalOpen, setExternalOpen] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [pinnedReorderMode, setPinnedReorderMode] = useState(false);
  const reorderRequestRef = useRef(0);
  const [unreadOnly, setUnreadOnly] = useChatUnreadsFilter();
  const [filterSwitched, setFilterSwitched] = useState(false);
  const reduceMotion = useReducedMotion();

  function handleUnreadOnlyChange(next: boolean) {
    setFilterSwitched(true);
    setUnreadOnly(next);
  }
  const [filterPass, setFilterPass] = useState(EMPTY_UNREAD_FILTER_PASS);
  // The highlight moves on click, before the route commits. Dim follows
  // that, or a read room stays faded under the bar until pathname catches up.
  const activeRoomId = selectedPath
    ? getActiveRoomIdFromSelection(selectedPath)
    : getActiveRoomIdFromPathname(pathname);
  const {
    rooms: otherWorkspaceRooms,
    pinnedRooms: listedOtherWorkspacePins,
    replaceRoom: replaceOtherWorkspaceRoom,
    applyPinnedOrder: applyOtherWorkspacePinnedOrder,
    readAgain: readOtherWorkspaceRoomsAgain,
  } = useOtherWorkspaceRooms({
    currentUserId,
    organizationId,
    activeRoomId,
    enabled: !paintOnly,
  });
  const elsewhereRooms = paintOnly ? [] : otherWorkspaceRooms;
  // Core's two answers share no room. The active list can still be the old
  // workspace's for a moment after a switch, and no room may show twice.
  const otherWorkspacePins = useMemo(
    () =>
      listedOtherWorkspacePins.filter(
        (room) => !roomRows.some((row) => row.id === room.id),
      ),
    [listedOtherWorkspacePins, roomRows],
  );
  // Every room the sections list, which Elsewhere rows are not.
  const listedRooms = useMemo(
    () => [...roomRows, ...otherWorkspacePins],
    [roomRows, otherWorkspacePins],
  );
  const { rows: elsewhereRows, overflowCount: elsewhereOverflowCount } =
    selectElsewhereRows(elsewhereRooms, activeRoomId);
  // All unreads (SOK-1159): the rooms a read would still change, newest
  // activity first. One answer for what the filter lists and whether the
  // reader is caught up, so the two cannot disagree.
  const unreadRooms = useMemo(
    () =>
      roomRows
        .filter(roomHasUnread)
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() ||
            a.id.localeCompare(b.id),
        ),
    [roomRows],
  );
  const groups = useMemo(
    () => partitionRoomsForSidebar(listedRooms),
    [listedRooms],
  );
  const {
    pinned,
    directMessages,
    namedChannels,
    externalJoined,
    hasOwnChannel,
    hasDirect,
  } = groups;
  useEffect(() => {
    if (!paintOnly) {
      rememberPinnedRooms(currentUserId, pinned);
    }
  }, [currentUserId, paintOnly, pinned]);
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
  // Rooms with a message waiting on the reader lead the filter, under their
  // own label: a question or decision for them comes before plain unread.
  const needsYouInboxRooms = inboxRooms.filter(
    (room) => (room.unreadNeedsYouCount ?? 0) > 0 && room.mutedAt == null,
  );
  const otherInboxRooms = inboxRooms.filter(
    (room) => !needsYouInboxRooms.includes(room),
  );
  const unreadRoomIds = new Set(
    [...unreadRooms, ...otherWorkspacePins.filter(roomHasUnread)].map(
      (room) => room.id,
    ),
  );
  const isUnreadRoom = (room: ChatRoom) => unreadRoomIds.has(room.id);
  // Past the limit a section still lists what is unread and the open room,
  // so nothing new waits behind "Show more".
  const keepInSection = (room: ChatRoom) =>
    room.id === activeRoomId || isUnreadRoom(room);
  // Read rooms dim, but not the open one: dimmed, its highlight reads as
  // disabled.
  const inboxItemProps = (room: ChatRoom) =>
    isUnreadRoom(room) || room.id === activeRoomId
      ? undefined
      : READ_INBOX_ROOM_ITEM_PROPS;
  const pinnedRoomIds = pinned.map((room) => room.id);
  // Reordering lives on the full Pinned section's header, which the filter
  // replaces; its Pinned group shows every pin, fixed. Folding Chats folds
  // Pinned with it, so it ends the mode the same way.
  const canReorderPinned =
    chatsOpen && pinnedOpen && pinned.length > 1 && !unreadOnly;
  // A pending invitation stays under the filter, in External, and keeps the
  // reader from being caught up: it is addressed to them and waits on them,
  // which is why a closed section already marks it as a mention
  // (`resolveSectionAttention`). Caught up is about what is unread, not what
  // is listed: pinned rooms and rooms read in the pass stay listed, dimmed. An
  // Elsewhere room counts, or this would stand under its unread row.
  const caughtUp =
    unreadOnly &&
    unreadRoomIds.size === 0 &&
    pendingRows.length === 0 &&
    !elsewhereRooms.some(roomHasUnread);
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
      ? () => handleReorderPinned(moveIdToSlot(pinnedRoomIds, roomId, targetId))
      : undefined;
  }

  function applyOrderToBothStores(order: StarredChatRoomOrder[]) {
    applyPinnedOrder(order);
    applyOtherWorkspacePinnedOrder(order);
  }

  function handleReorderPinned(roomIds: string[]) {
    const request = ++reorderRequestRef.current;
    // Local sort keys for now; Core writes its own, which its answer brings.
    // The order is what matters, and it is the same.
    const base = Date.now() - roomIds.length;
    const localOrder = roomIds.map((roomId, index) => ({
      roomId,
      starredAt: new Date(base + index),
    }));
    applyOrderToBothStores(localOrder);

    async function reloadAfterFailure() {
      // A newer reorder owns the list now.
      if (request !== reorderRequestRef.current) return;
      toast.error(tActions("actionFailed"));
      // What Core holds is the truth: an earlier overlapping reorder may
      // have landed, so no local snapshot is safe to put back.
      readOtherWorkspaceRoomsAgain();
      const requestRevision = beginRoomAttentionRefresh();
      const roomsResult = await listOrganizationChatRoomsAction();
      if (roomsResult.ok && request === reorderRequestRef.current) {
        replaceAllRooms(roomsResult.value.rooms, requestRevision);
      }
    }

    void reorderPinnedOrganizationChatRoomsAction(roomIds).then((result) => {
      if (!result.ok) return reloadAfterFailure();
      if (request !== reorderRequestRef.current) return;
      // Core's keys in both stores: the next read of one sorts against the
      // other, which still holds these. That read also brings what a dropped
      // read held, and the other workspaces' copies are stale now.
      applyOrderToBothStores(result.value);
      readOtherWorkspaceRoomsAgain();
    }, reloadAfterFailure);
  }

  function roomRowProps(room: ChatRoom): ChatRoomSidebarRowProps {
    const isDirect = room.kind === "direct";
    const isOtherWorkspacePin = otherWorkspacePins.includes(room);
    return {
      room,
      href: `/chat/rooms/${room.id}`,
      label: isDirect ? roomDisplayName(room, currentUserId) : room.name,
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
        <ChannelKindGlyph discoverability={room.discoverability} />
      ),
      onRoomUpdated: isOtherWorkspacePin
        ? replaceOtherWorkspaceRoom
        : replaceRoom,
      dismissSheetOnNavigate,
      // As on an Elsewhere row: the room works out its own role once it opens.
      canManageSettings:
        !isOtherWorkspacePin &&
        canManageChannelSettings(room, isOrgOwnerOrAdmin),
      workspaceName: isOtherWorkspacePin ? roomWorkspaceName(room) : undefined,
    };
  }

  const catchUp = (
    <ChatUnreadNavRows
      rooms={roomRows}
      markAllRooms={listedRooms}
      dismissSheetOnNavigate={dismissSheetOnNavigate}
      unreadOnly={unreadOnly}
      onUnreadOnlyChange={withChatsHeading ? undefined : handleUnreadOnlyChange}
    />
  );
  const elsewhere = (
    <>
      {/* Outside the keyed list below: the Unreads filter does not touch them,
          because hiding what is unread is the last thing it should do. */}
      {elsewhereRows.length > 0 ? (
        <SidebarMenu
          data-slot="elsewhere-rows"
          aria-label={t("UnreadNav.elsewhereLabel")}
          className="gap-0"
        >
          {elsewhereRows.map((room) => (
            <ChatRoomSidebarRow
              key={room.id}
              {...roomRowProps(room)}
              subtitle={roomWorkspaceName(room) ?? undefined}
              onRoomUpdated={replaceOtherWorkspaceRoom}
              // The active workspace's role says nothing about this room. The
              // room works out its own once it opens (ADR-0061).
              canManageSettings={false}
              elsewhere
            />
          ))}
          {elsewhereOverflowCount > 0 ? (
            <ChatElsewhereOverflowRow
              count={elsewhereOverflowCount}
              dismissSheetOnNavigate={dismissSheetOnNavigate}
            />
          ) : null}
        </SidebarMenu>
      ) : null}
    </>
  );
  const inbox = {
    caughtUp,
    showsReadLabel,
    needsYouInboxRooms,
    otherInboxRooms,
    roomRowProps,
    inboxItemProps,
  };
  const unreadInbox = unreadOnly ? <ChatUnreadInbox {...inbox} /> : null;
  const pinnedSection =
    !unreadOnly && pinned.length > 0 ? (
      <Collapsible open={pinnedOpen} onOpenChange={setPinnedOpen}>
        <ChatSidebarSectionHeader
          isOpen={pinnedOpen}
          closedAttention={resolveSectionAttention(pinned)}
          createAction={
            canReorderPinned ? (
              <button
                type="button"
                aria-pressed={isReorderingPinned}
                aria-label={t(
                  isReorderingPinned ? "reorderPinnedDone" : "reorderPinned",
                )}
                className={SIDEBAR_ICON_ACTION_CLASS}
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
        {/* A row being dragged translates past the section's box, and the
                animation's `overflow-hidden` would cut it off. Dropping the
                clip cannot cost the section its animation, because
                `canReorderPinned` carries `pinnedOpen`: the render that
                closes Pinned is already the render where `isReorderingPinned`
                reads false, so the collapse clips as every other section
                does. */}
        <SidebarSectionContent
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
                    onMoveUp={movePinnedTo(room.id, pinnedRoomIds[index - 1])}
                    onMoveDown={movePinnedTo(room.id, pinnedRoomIds[index + 1])}
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
        </SidebarSectionContent>
      </Collapsible>
    ) : null;
  const unreadPins =
    inboxPinnedRooms.length > 0 ? (
      <UnreadPinnedRooms
        rooms={inboxPinnedRooms}
        roomRowProps={roomRowProps}
        inboxItemProps={inboxItemProps}
      />
    ) : null;
  const channelsSection =
    hasOrganization &&
    !unreadOnly &&
    (children == null || namedChannels.length > 0) ? (
      <SidebarRoomSection
        kind="channels"
        open={channelsOpen}
        onOpenChange={setChannelsOpen}
        title={t("title")}
        emptyMessage={hasOwnChannel ? undefined : t("Empty.noChannels")}
        rooms={namedChannels}
        createAction={<CreateChannelDialog />}
        secondaryAction={<BrowseChannelsDialog />}
        keepInSection={keepInSection}
        roomRowProps={roomRowProps}
      />
    ) : null;
  /*
   * Sidebar rows = messaged history only. `+` opens Start New Direct
   * in place (org members + coworkers, 1:1 coworker / group humans).
   * Personal workspace still mounts the picker with empty members
   * (coworkers only).
   */
  const directSection =
    !unreadOnly && (children == null || directMessages.length > 0) ? (
      <SidebarRoomSection
        kind="direct"
        open={directOpen}
        onOpenChange={setDirectOpen}
        title={t("directMessages")}
        emptyMessage={hasDirect ? undefined : t("Empty.noDirectMessages")}
        rooms={directMessages}
        createAction={<CreateDirectDialog />}
        keepInSection={keepInSection}
        roomRowProps={roomRowProps}
      />
    ) : null;
  const archivedSection =
    hasOrganization && !unreadOnly && archivedRows.length > 0 ? (
      <ArchivedChatSection
        open={archivedOpen}
        onOpenChange={setArchivedOpen}
        archivedRows={archivedRows}
        setArchivedRows={setArchivedRows}
        upsertRoomToTop={upsertRoomToTop}
        isOrgOwnerOrAdmin={isOrgOwnerOrAdmin}
      />
    ) : null;
  const externalSection =
    pendingRows.length > 0 || (!unreadOnly && externalJoined.length > 0) ? (
      <ExternalChatSection
        open={externalOpen}
        onOpenChange={setExternalOpen}
        externalJoined={externalJoined}
        pendingRows={pendingRows}
        {...invitationResponses}
        unreadOnly={unreadOnly}
        keepInSection={keepInSection}
        roomRowProps={roomRowProps}
      />
    ) : null;
  const actions = (
    <>
      <ChatMarkAllReadButton rooms={listedRooms} unreadOnly={unreadOnly} />
      <ChatUnreadsFilterChip
        unreadOnly={unreadOnly}
        onUnreadOnlyChange={handleUnreadOnlyChange}
      />
    </>
  );
  const transition = reduceMotion ? { duration: 0 } : UNREAD_FILTER_TRANSITION;
  const filterClassName = cn(
    !unreadOnly && "chat-unreads-boot:hidden",
    filterSwitched &&
      `motion-safe:animate-in motion-safe:fade-in ${UNREAD_FILTER_CSS_TIMING}`,
  );
  if (children != null) {
    // A movable collection still needs the boot guard that wraps the full list.
    const collection = (rows: ReactNode) =>
      rows ? <div className={filterClassName}>{rows}</div> : null;
    return (
      <MotionConfig transition={transition}>
        <SidebarChatContext
          value={{
            entries: {
              "catch-up": (
                <>
                  {catchUp}
                  {elsewhere}
                  {unreadInbox}
                </>
              ),
              pinned: collection(unreadOnly ? unreadPins : pinnedSection),
              channels: collection(channelsSection),
              external: collection(externalSection),
              archived: collection(archivedSection),
              "direct-messages": collection(directSection),
            },
            unreadCategories: unreadOnly
              ? groupUnreadInbox(inbox, groups, externalSection)
              : undefined,
            controls: {
              attentionFor: sidebarChatAttention(
                groups,
                roomRows,
                [...elsewhereRooms, ...inboxRooms],
                pendingRows.length > 0,
              ),
              actions,
              onOpenChange: (open) => {
                // Pinned can live in a different section from the filter controls.
                // This handler belongs to the section that contains Pinned.
                if (!open) setPinnedReorderMode(false);
              },
            },
          }}
        >
          {children}
        </SidebarChatContext>
      </MotionConfig>
    );
  }
  const attention = resolveChatsAttention([...listedRooms, ...elsewhereRooms], {
    hasPendingInvitation: pendingRows.length > 0,
  });
  // Catch up, then the sections: the block the Chats heading folds.
  const chatArea = (
    <SidebarGroupContent className="space-y-2">
      {catchUp}
      {elsewhere}
      {/* One list per mode, so switching fades the new one in instead of
        swapping rows under the pointer. Not on first render: the sidebar
        does not fade in on every load. A reader who left the filter on
        gets no All list until React reads the cookie: the prerendered
        shell always draws All, and the boot script's mark hides it. */}
      <div
        key={unreadOnly ? "unread" : "all"}
        className={cn("space-y-2", filterClassName)}
      >
        {unreadInbox}
        {pinnedSection}
        {channelsSection}
        {externalSection}
        {/* After External: a pending invitation waits on the reader, as an
            unread room does. */}
        {unreadPins}
        {archivedSection}
        {directSection}
      </div>
    </SidebarGroupContent>
  );

  return (
    <SidebarGroup className="w-full">
      <MotionConfig transition={transition}>
        {withChatsHeading ? (
          <Collapsible open={chatsOpen} onOpenChange={setChatsOpen}>
            {/* Folded, the heading says what the rooms under it hold, as a
                folded section's does. */}
            <ChatSidebarSectionHeader
              isOpen={chatsOpen}
              closedAttention={attention}
              inlineAction={actions}
            >
              {t("chats")}
            </ChatSidebarSectionHeader>
            {/* A pinned row being dragged leaves the block's box too; see
                Pinned's own content below. `canReorderPinned` carries
                `chatsOpen`, so folding clips as any section does. */}
            <SidebarSectionContent
              className={cn(isReorderingPinned && "overflow-visible")}
            >
              {chatArea}
            </SidebarSectionContent>
          </Collapsible>
        ) : (
          chatArea
        )}
      </MotionConfig>
    </SidebarGroup>
  );
}
