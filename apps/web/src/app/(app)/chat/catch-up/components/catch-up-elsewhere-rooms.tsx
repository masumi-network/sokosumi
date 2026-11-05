"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import {
  useRoomDisplayName,
  useRoomWorkspaceName,
} from "@/app/chat/components/use-room-display-name";
import { chatRoomHref } from "@/app/chat/utils/chat-route-base";
import { RowCountMark } from "@/components/chat/mention-count-pill";
import {
  MentionAnnouncement,
  NeedsYouAnnouncement,
  RoomUnreadCount,
  useRoomRowAttention,
} from "@/components/chat/room-row-attention";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { POPOVER_ROW_CLASS } from "@/components/ui/popover-row-classes";
import { cn } from "@/lib/utils";

interface CatchUpElsewhereRoomsProps {
  rooms: readonly ChatRoom[];
  currentUserId: string;
}

/**
 * Every unread room of the reader's other workspaces, by workspace (ADR-0061):
 * what the sidebar's overflow row promises. Only other workspaces, because the
 * sidebar already lists the active one's rooms. Workspaces and rooms keep
 * Core's order, so the workspace naming the reader comes first.
 */
export function CatchUpElsewhereRooms({
  rooms,
  currentUserId,
}: CatchUpElsewhereRoomsProps) {
  const t = useTranslations("App.Channels.UnreadNav");
  const roomWorkspaceName = useRoomWorkspaceName();
  const headingId = useId();

  if (rooms.length === 0) {
    return null;
  }

  const workspaces = new Map<string | null, ChatRoom[]>();
  for (const room of rooms) {
    const workspace = workspaces.get(room.organizationId);
    if (workspace) {
      workspace.push(room);
    } else {
      workspaces.set(room.organizationId, [room]);
    }
  }

  return (
    <div className={HOLDER_CLASS}>
      <section
        aria-labelledby={headingId}
        className={cn(HOLDER_ITEM_CLASS, "flex flex-col gap-3 p-4 md:p-5")}
      >
        <h2 id={headingId} className="px-2 text-sm font-medium">
          {t("elsewhereLabel")}
        </h2>
        {[...workspaces].map(([organizationId, workspaceRooms]) => (
          <CatchUpElsewhereWorkspace
            key={organizationId}
            label={roomWorkspaceName(workspaceRooms[0])}
            rooms={workspaceRooms}
            currentUserId={currentUserId}
          />
        ))}
      </section>
    </div>
  );
}

interface CatchUpElsewhereWorkspaceProps {
  label: string | null | undefined;
  rooms: readonly ChatRoom[];
  currentUserId: string;
}

function CatchUpElsewhereWorkspace({
  label,
  rooms,
  currentUserId,
}: CatchUpElsewhereWorkspaceProps) {
  const headingId = useId();
  return (
    <div className="flex flex-col gap-1">
      <h3
        id={headingId}
        className="text-muted-foreground px-2 text-xs font-medium"
      >
        {label}
      </h3>
      <ul aria-labelledby={headingId} className="flex flex-col">
        {rooms.map((room) => (
          <li key={room.id}>
            <CatchUpElsewhereRow room={room} currentUserId={currentUserId} />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface CatchUpElsewhereRowProps {
  room: ChatRoom;
  currentUserId: string;
}

/** A plain room link: opening it starts a Room visit, like any room link. */
function CatchUpElsewhereRow({
  room,
  currentUserId,
}: CatchUpElsewhereRowProps) {
  const roomDisplayName = useRoomDisplayName();
  const { bold, mentionCount, needsYouCount, unreadTextCount } =
    useRoomRowAttention(room, { elsewhere: true });
  return (
    <Link
      href={chatRoomHref(room.id)}
      className={cn(POPOVER_ROW_CLASS, "flex items-center gap-2 px-2 py-1.5")}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          bold && "font-semibold",
        )}
      >
        {room.kind === "direct"
          ? roomDisplayName(room, currentUserId)
          : room.name}
      </span>
      <RoomUnreadCount count={unreadTextCount} />
      <MentionAnnouncement count={mentionCount} />
      <NeedsYouAnnouncement count={needsYouCount} />
      <span aria-hidden className="inline-flex shrink-0">
        <RowCountMark
          mentionCount={mentionCount}
          needsYouCount={needsYouCount}
          count={unreadTextCount}
        />
      </span>
    </Link>
  );
}
