"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import { markAllChatUnreadReadAction } from "@/app/chat/actions";
import {
  ChatCaughtUp,
  ChatUnreadViewHeader,
} from "@/app/chat/components/chat-unread-view-header";
import { getRoomDisplayName } from "@/app/chat/components/room-helpers";
import { chatRoomHref } from "@/app/chat/utils/chat-route-base";
import { ChannelRoomMark } from "@/components/chat/channel-room-mark";
import { ChatRoomThreadRows } from "@/components/chat/chat-room-thread-rows";
import { DirectRoomAvatarStack } from "@/components/chat/direct-room-avatar-stack";
import { RowCountMark } from "@/components/chat/mention-count-pill";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import {
  listAllUnreadRooms,
  resolveRoomAttention,
  roomBadgeCountsMentions,
} from "@/components/chat/room-attention";
import { ROOM_COUNT_CAP } from "@/components/chat/room-count-label";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";
import { Button } from "@/components/ui/button";
import { SidebarRowSlot } from "@/components/ui/sidebar";
import { SIDEBAR_ROW_CLASS } from "@/components/ui/sidebar-classes";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

interface AllUnreadsViewProps {
  /** The rooms as the sidebar cache held them, until the live read lands. */
  initialRooms: readonly ChatRoom[];
  currentUserId: string;
}

/**
 * The All unreads view (SOK-1159): every room with unread, top-level unread
 * first, each with its unread Threads inset under it the way the sidebar
 * draws them. One list that drains as the reader reads, and Mark all as read
 * at the top.
 *
 * It holds no data of its own: the rooms are the sidebar's, read live, so a
 * room goes the moment its row goes quiet.
 */
export function AllUnreadsView({
  initialRooms,
  currentUserId,
}: AllUnreadsViewProps) {
  const t = useTranslations("App.Channels.AllUnreadsView");
  const tChannels = useTranslations("App.Channels");
  const liveRooms = useLiveChatRooms();
  const rooms = listAllUnreadRooms(
    liveRooms.length > 0 ? liveRooms : initialRooms,
  );
  const [isMarking, startMarking] = useTransition();

  function handleMarkAllRead() {
    const targets = rooms.map((room) => ({
      roomId: room.id,
      readRoom: roomAttention(room).bold,
      lookThreads: (room.unreadThreadCount ?? 0) > 0,
    }));
    startMarking(async () => {
      const result = await markAllChatUnreadReadAction(targets);
      if (!result.ok) {
        toast.error(t("markAllReadError"));
      }
      // What Core holds now, part-read or not, is what the rooms show next.
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    });
  }

  return (
    <div className="flex flex-col gap-5 pb-4">
      <ChatUnreadViewHeader
        title={t("title")}
        action={
          rooms.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleMarkAllRead}
              disabled={isMarking}
              aria-busy={isMarking}
            >
              {isMarking ? (
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : null}
              {t("markAllRead")}
            </Button>
          ) : null
        }
      />
      {rooms.length === 0 ? (
        <ChatCaughtUp title={t("empty")} description={t("emptyDescription")} />
      ) : (
        <ul aria-label={t("title")} className="flex flex-col gap-2">
          {rooms.map((room) => {
            const label = getRoomDisplayName(
              room,
              currentUserId,
              tChannels("SelfDirect.you"),
            );
            const { bold, mentionCount } = roomAttention(room);
            const channelUnread = room.channelUnreadCount ?? 0;
            return (
              <li
                key={room.id}
                data-testid="all-unreads-room"
                className="bg-card-background rounded-md py-1"
              >
                <Link
                  href={chatRoomHref(room.id)}
                  className={cn(
                    SIDEBAR_ROW_CLASS,
                    "hover:bg-accent text-muted-foreground rounded-md",
                  )}
                >
                  <SidebarRowSlot>
                    {room.kind === "direct" ? (
                      <DirectRoomAvatarStack
                        room={room}
                        currentUserId={currentUserId}
                      />
                    ) : (
                      <ChannelRoomMark room={room} />
                    )}
                  </SidebarRowSlot>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      bold && "text-foreground font-semibold",
                    )}
                  >
                    {label}
                  </span>
                  {/* One number, in the column the Thread rows below keep
                      theirs in: the `@` pill where the reader was named, the
                      muted count of top-level unread otherwise. */}
                  <span className="flex w-7 shrink-0 justify-center">
                    <span aria-hidden>
                      <RowCountMark
                        mentionCount={mentionCount}
                        count={channelUnread}
                      />
                    </span>
                    <span className="sr-only">
                      {mentionCount > 0
                        ? tChannels("RoomMentions.mentions", {
                            count: mentionCount,
                          })
                        : channelUnread > ROOM_COUNT_CAP
                          ? tChannels("RoomUnread.unreadMessagesCapped", {
                              max: ROOM_COUNT_CAP,
                            })
                          : channelUnread > 0
                            ? tChannels("RoomUnread.unreadMessages", {
                                count: channelUnread,
                              })
                            : null}
                    </span>
                  </span>
                </Link>
                <ChatRoomThreadRows room={room} roomLabel={label} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  function roomAttention(room: ChatRoom) {
    return resolveRoomAttention({
      unreadCount: room.unreadCount,
      channelUnreadCount: room.channelUnreadCount,
      unreadMentionCount: room.unreadMentionCount,
      markedUnread: room.markedUnread,
      isMuted: room.mutedAt != null,
      badgeCountsMentions: roomBadgeCountsMentions(room),
    });
  }
}
