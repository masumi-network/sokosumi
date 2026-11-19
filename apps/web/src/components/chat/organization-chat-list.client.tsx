"use client";

import type {
  ChatRoom,
  ChatRoomInvitation,
  StarredChatRoomOrder,
} from "@sokosumi/core-client";
import { MotionConfig, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
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
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { SIDEBAR_ROW_LABEL_INSET_CLASS } from "@/components/ui/sidebar-classes";
import { SidebarSectionContent } from "@/components/ui/sidebar-section";
import { cn } from "@/lib/utils";
import { moveIdToSlot } from "@/lib/utils/move-id";
import {
  getActiveRoomIdFromPathname,
  getActiveRoomIdFromSelection,
} from "./active-room-id";
import { ChannelKindGlyph } from "./channel-discoverability-icon";
import {
  ArchivedRoomsSection,
  useArchivedRoomActions,
} from "./chat-archived-rooms-section";
import { ChatElsewhereOverflowRow } from "./chat-elsewhere-overflow-row";
import {
  ExternalRoomsSection,
  useRoomInvitationActions,
} from "./chat-external-rooms-section";
import { PinnedRoomsSection } from "./chat-pinned-rooms-section";
import {
  ChatRoomSidebarRow,
  type ChatRoomSidebarRowProps,
} from "./chat-room-sidebar-row";
import { ChatSidebarSectionHeader } from "./chat-sidebar-section-header";
import {
  READ_INBOX_ROOM_ITEM_PROPS,
  UNREAD_FILTER_CSS_TIMING,
  UNREAD_FILTER_TRANSITION,
  UnreadInboxPinnedRooms,
  UnreadInboxSection,
} from "./chat-unread-inbox-section";
import {
  ChatMarkAllReadButton,
  ChatUnreadNavRows,
  ChatUnreadsFilterChip,
} from "./chat-unread-nav-rows";
import { DirectRoomAvatarStack } from "./direct-room-avatar-stack";
import {
  listOrganizationChatRoomsAction,
  reorderPinnedOrganizationChatRoomsAction,
} from "./organization-chat-list.actions";
import { partitionRoomsForSidebar } from "./partition-rooms-for-sidebar";
import { rememberPinnedRooms } from "./remembered-pinned-rooms";
import {
  resolveChatsAttention,
  resolveSectionAttention,
  roomHasUnread,
} from "./room-attention";
import { beginRoomAttentionRefresh } from "./room-read-overlay";
import { selectElsewhereRows } from "./select-elsewhere-rows";
import { SidebarSectionShowMoreRow } from "./sidebar-section-show-more-row";
import {
  advanceUnreadFilterPass,
  EMPTY_UNREAD_FILTER_PASS,
} from "./unread-filter-pass";
import { useChatPageSearch } from "./use-chat-page-search";
import { useChatUnreadsFilter } from "./use-chat-unreads-filter";
import { useOrganizationChatRooms } from "./use-organization-chat-rooms";
import { useOtherWorkspaceRooms } from "./use-other-workspace-rooms";
import { useSidebarSectionShowAll } from "./use-sidebar-section-show-all";

/** Stable empty default — inline `= []` is a new array every render and
 *  infinite-loops the render-time pendingInvitations sync (React #301). */
const EMPTY_PENDING_INVITATIONS: ChatRoomInvitation[] = [];

interface OrganizationChatListProps {
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
  const archivedActions = useArchivedRoomActions({
    setArchivedRows,
    upsertRoomToTop,
  });
  const invitationActions = useRoomInvitationActions({
    pendingRows,
    setPendingRows,
    replaceAllRooms,
  });
  // In memory only, as the nav groups' are: the area comes back on reload.
  const [chatsOpen, setChatsOpen] = useState(true);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [pinnedReorderMode, setPinnedReorderMode] = useState(false);
  const reorderRequestRef = useRef(0);
  const [channelSectionOpen, setChannelSectionOpen] = useState(true);
  const [archivedSectionOpen, setArchivedSectionOpen] = useState(false);
  const [directOpen, setDirectOpen] = useState(true);
  const [externalOpen, setExternalOpen] = useState(true);
  const [channelsShowAll, setChannelsShowAll] =
    useSidebarSectionShowAll("channels");
  const [externalShowAll, setExternalShowAll] =
    useSidebarSectionShowAll("external");
  const [directShowAll, setDirectShowAll] = useSidebarSectionShowAll("direct");
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
  const {
    pinned,
    directMessages,
    namedChannels,
    externalJoined,
    hasOwnChannel,
    hasDirect,
  } = useMemo(() => partitionRoomsForSidebar(listedRooms), [listedRooms]);
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
  const search = useChatPageSearch({
    rooms: unreadOnly ? [...inboxRooms, ...pinned] : listedRooms,
    elsewhere: elsewhereRooms,
    archived: hasOrganization && !unreadOnly ? archivedRows : [],
    invitations: pendingRows,
    currentUserId,
  });
  const channelRows = search.limited(
    namedChannels,
    channelsShowAll,
    keepInSection,
  );
  const externalRows = search.limited(
    externalJoined,
    externalShowAll,
    keepInSection,
  );
  const directRows = search.limited(
    directMessages,
    directShowAll,
    keepInSection,
  );
  // Read rooms dim, but not the open one: dimmed, its highlight reads as
  // disabled.
  function inboxRoomRowProps(room: ChatRoom): ChatRoomSidebarRowProps {
    return {
      ...roomRowProps(room),
      itemProps:
        isUnreadRoom(room) || room.id === activeRoomId
          ? undefined
          : READ_INBOX_ROOM_ITEM_PROPS,
    };
  }
  const pinnedRoomIds = pinned.map((room) => room.id);
  // Reordering lives on the full Pinned section's header, which the filter
  // replaces; its Pinned group shows every pin, fixed. Folding Chats folds
  // Pinned with it, so it ends the mode the same way.
  const canReorderPinned =
    chatsOpen &&
    pinnedOpen &&
    pinned.length > 1 &&
    !unreadOnly &&
    !search.active;
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

  const sortedArchivedChannels = useMemo(() => {
    return [...archivedRows].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }, [archivedRows]);

  // Catch up, then the sections: the block the Chats heading folds.
  const chatArea = (
    <SidebarGroupContent className="space-y-2">
      <ChatUnreadNavRows
        rooms={roomRows}
        markAllRooms={listedRooms}
        dismissSheetOnNavigate={dismissSheetOnNavigate}
        unreadOnly={unreadOnly}
        onUnreadOnlyChange={
          withChatsHeading ? undefined : handleUnreadOnlyChange
        }
      />
      {/* Outside the keyed list below: the Unreads filter does not touch them,
          because hiding what is unread is the last thing it should do. */}
      {(search.active ? elsewhereRooms : elsewhereRows).length > 0 ? (
        <SidebarMenu
          data-slot="elsewhere-rows"
          aria-label={t("UnreadNav.elsewhereLabel")}
          className="gap-0"
        >
          {(search.active
            ? search.matching(
                elsewhereRooms.filter((room) => room.starredAt == null),
              )
            : elsewhereRows
          ).map((room) => (
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
          {!search.active && elsewhereOverflowCount > 0 ? (
            <ChatElsewhereOverflowRow
              count={elsewhereOverflowCount}
              dismissSheetOnNavigate={dismissSheetOnNavigate}
            />
          ) : null}
        </SidebarMenu>
      ) : null}
      {/* One list per mode, so switching fades the new one in instead of
        swapping rows under the pointer. Not on first render: the sidebar
        does not fade in on every load. A reader who left the filter on
        gets no All list until React reads the cookie: the prerendered
        shell always draws All, and the boot script's mark hides it. */}
      <div
        key={unreadOnly ? "unread" : "all"}
        className={cn(
          "space-y-2",
          !unreadOnly && "chat-unreads-boot:hidden",
          filterSwitched &&
            `motion-safe:animate-in motion-safe:fade-in ${UNREAD_FILTER_CSS_TIMING}`,
        )}
      >
        {unreadOnly ? (
          <UnreadInboxSection
            caughtUp={caughtUp}
            showsReadLabel={showsReadLabel}
            hasNeedsYou={needsYouInboxRooms.length > 0}
            needsYou={search.matching(needsYouInboxRooms)}
            other={search.matching(otherInboxRooms)}
            roomRowProps={inboxRoomRowProps}
          />
        ) : null}
        {!unreadOnly && pinned.length > 0 ? (
          <PinnedRoomsSection
            pinned={pinned}
            visible={search.matching(pinned)}
            open={search.active || pinnedOpen}
            onOpenChange={setPinnedOpen}
            canReorderPinned={canReorderPinned}
            isReorderingPinned={isReorderingPinned}
            onToggleReorder={() => setPinnedReorderMode((current) => !current)}
            pinnedRoomIds={pinnedRoomIds}
            onReorder={handleReorderPinned}
            movePinnedTo={movePinnedTo}
            roomRowProps={roomRowProps}
          />
        ) : null}

        {hasOrganization && !unreadOnly ? (
          <Collapsible
            open={search.active || channelSectionOpen}
            onOpenChange={setChannelSectionOpen}
          >
            <ChatSidebarSectionHeader
              isOpen={search.active || channelSectionOpen}
              closedAttention={resolveSectionAttention(namedChannels)}
              createAction={<CreateChannelDialog />}
              secondaryAction={<BrowseChannelsDialog />}
            >
              {t("title")}
            </ChatSidebarSectionHeader>
            <SidebarSectionContent>
              <SidebarMenu className="gap-0">
                {channelRows.visible.map((room) => (
                  <ChatRoomSidebarRow key={room.id} {...roomRowProps(room)} />
                ))}
                {channelRows.hiddenCount > 0 ? (
                  <SidebarSectionShowMoreRow
                    hiddenCount={channelRows.hiddenCount}
                    showAll={channelsShowAll}
                    onShowAllChange={setChannelsShowAll}
                  />
                ) : null}
                {!hasOwnChannel ? (
                  <SidebarMenuItem>
                    <div
                      className={cn(
                        SIDEBAR_ROW_LABEL_INSET_CLASS,
                        "text-muted-foreground py-1.5 pr-2 text-xs",
                      )}
                    >
                      {t("Empty.noChannels")}
                    </div>
                  </SidebarMenuItem>
                ) : null}
              </SidebarMenu>
            </SidebarSectionContent>
          </Collapsible>
        ) : null}

        {pendingRows.length > 0 ||
        (!unreadOnly && externalJoined.length > 0) ? (
          <ExternalRoomsSection
            rooms={externalJoined}
            rows={externalRows}
            invitations={search.invitations}
            hasPendingInvitation={pendingRows.length > 0}
            actions={invitationActions}
            open={search.active || externalOpen}
            onOpenChange={setExternalOpen}
            unreadOnly={unreadOnly}
            showAll={externalShowAll}
            onShowAllChange={setExternalShowAll}
            roomRowProps={roomRowProps}
          />
        ) : null}

        {/* After External: a pending invitation waits on the reader, as an
            unread room does. */}
        {inboxPinnedRooms.length > 0 ? (
          <UnreadInboxPinnedRooms
            rooms={search.matching(inboxPinnedRooms)}
            roomRowProps={inboxRoomRowProps}
          />
        ) : null}
        <ArchivedRoomsSection
          actions={archivedActions}
          rooms={search.matching(sortedArchivedChannels)}
          visible={
            hasOrganization && !unreadOnly && sortedArchivedChannels.length > 0
          }
          open={search.active || archivedSectionOpen}
          onOpenChange={setArchivedSectionOpen}
          isOrgOwnerOrAdmin={isOrgOwnerOrAdmin}
        />

        {!unreadOnly ? (
          <Collapsible
            open={search.active || directOpen}
            onOpenChange={setDirectOpen}
          >
            {/*
            Sidebar rows = messaged history only. `+` opens Start New Direct
            in place (org members + coworkers, 1:1 coworker / group humans).
            Personal workspace still mounts the picker with empty members
            (coworkers only).
          */}
            <ChatSidebarSectionHeader
              isOpen={search.active || directOpen}
              closedAttention={resolveSectionAttention(directMessages)}
              createAction={<CreateDirectDialog />}
            >
              {t("directMessages")}
            </ChatSidebarSectionHeader>
            <SidebarSectionContent>
              <SidebarMenu className="gap-0">
                {directRows.visible.map((room) => (
                  <ChatRoomSidebarRow key={room.id} {...roomRowProps(room)} />
                ))}
                {directRows.hiddenCount > 0 ? (
                  <SidebarSectionShowMoreRow
                    hiddenCount={directRows.hiddenCount}
                    showAll={directShowAll}
                    onShowAllChange={setDirectShowAll}
                  />
                ) : null}
                {!hasDirect ? (
                  <SidebarMenuItem>
                    <div
                      className={cn(
                        SIDEBAR_ROW_LABEL_INSET_CLASS,
                        "text-muted-foreground py-1.5 pr-2 text-xs",
                      )}
                    >
                      {t("Empty.noDirectMessages")}
                    </div>
                  </SidebarMenuItem>
                ) : null}
              </SidebarMenu>
            </SidebarSectionContent>
          </Collapsible>
        ) : null}
      </div>
    </SidebarGroupContent>
  );

  return (
    <SidebarGroup className="w-full">
      <MotionConfig
        transition={reduceMotion ? { duration: 0 } : UNREAD_FILTER_TRANSITION}
      >
        {withChatsHeading ? (
          <Collapsible open={chatsOpen} onOpenChange={setChatsOpen}>
            {/* Folded, the heading says what the rooms under it hold, as a
                folded section's does. */}
            <ChatSidebarSectionHeader
              isOpen={chatsOpen}
              closedAttention={resolveChatsAttention(
                [...listedRooms, ...elsewhereRooms],
                { hasPendingInvitation: pendingRows.length > 0 },
              )}
              inlineAction={
                <>
                  <ChatMarkAllReadButton
                    rooms={listedRooms}
                    unreadOnly={unreadOnly}
                  />
                  <ChatUnreadsFilterChip
                    unreadOnly={unreadOnly}
                    onUnreadOnlyChange={handleUnreadOnlyChange}
                  />
                </>
              }
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
