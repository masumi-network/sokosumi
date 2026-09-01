"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { getRoomDisplayName } from "@/app/chat/components/room-helpers";
import { ChannelDiscoverabilityIcon } from "@/components/chat/channel-discoverability-icon";
import { DirectRoomAvatarStack } from "@/components/chat/direct-room-avatar-stack";
import { partitionRoomsForSidebar } from "@/components/chat/partition-rooms-for-sidebar";
import { resolveRoomAttention } from "@/components/chat/room-attention";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

interface ChatChatsListSnapshotPreviewProps {
  rooms: ChatRoom[];
  currentUserId: string;
  organizationId: string | null;
}

function SnapshotMentionBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }

  const label = count > 99 ? "99+" : String(count);

  return (
    <span
      aria-label={`${label} mentions`}
      className="bg-primary text-primary-foreground inline-flex min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[0.625rem] leading-4 font-semibold tabular-nums"
    >
      {label}
    </span>
  );
}

function SnapshotRoomRow({
  room,
  label,
  leading,
}: {
  room: ChatRoom;
  label: string;
  leading: ReactNode;
}) {
  const isMuted = room.mutedAt != null;
  const { bold, badgeCount } = resolveRoomAttention({
    unreadCount: room.unreadCount,
    unreadMentionCount: room.unreadMentionCount,
    markedUnread: room.markedUnread,
    isMuted,
    isActive: false,
  });

  return (
    <li>
      <Link
        href={`/chat/rooms/${room.id}`}
        className={cn(
          "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex min-h-auto w-full items-center gap-2 px-3 py-1.5",
          isMuted && "opacity-60",
        )}
      >
        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center">
          {leading}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            bold && "font-semibold text-foreground",
            isMuted && "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <SnapshotMentionBadge count={badgeCount} />
      </Link>
    </li>
  );
}

/**
 * Instant-only first paint of last-known membership-visible rooms.
 * No polls, Ably, menus, or section chrome — RSC replaces this with
 * OrganizationChatList. Keeps Instant shell free of realtime side effects.
 */
export function ChatChatsListSnapshotPreview({
  rooms,
  currentUserId,
  organizationId,
}: ChatChatsListSnapshotPreviewProps) {
  const hasOrganization = Boolean(organizationId);
  const { namedChannels, directMessages, externalJoined } =
    partitionRoomsForSidebar(rooms);

  return (
    <div className="w-full space-y-2 pt-2">
      {hasOrganization && namedChannels.length > 0 ? (
        <ul className="flex flex-col">
          {namedChannels.map((room) => (
            <SnapshotRoomRow
              key={room.id}
              room={room}
              label={room.name}
              leading={
                <ChannelDiscoverabilityIcon
                  discoverability={room.discoverability}
                />
              }
            />
          ))}
        </ul>
      ) : null}

      {externalJoined.length > 0 ? (
        <ul className="flex flex-col">
          {externalJoined.map((room) => (
            <SnapshotRoomRow
              key={room.id}
              room={room}
              label={room.name}
              leading={
                <ChannelDiscoverabilityIcon discoverability="external" />
              }
            />
          ))}
        </ul>
      ) : null}

      {directMessages.length > 0 ? (
        <ul className="flex flex-col">
          {directMessages.map((room) => (
            <SnapshotRoomRow
              key={room.id}
              room={room}
              label={getRoomDisplayName(room, currentUserId)}
              leading={
                <DirectRoomAvatarStack
                  room={room}
                  currentUserId={currentUserId}
                  canOpenHumanDirect={hasOrganization}
                  selectedRoomId={null}
                />
              }
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
