"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";

import {
  resolveRoomAttention,
  roomBadgeCountsMentions,
} from "./room-attention";
import { ROOM_COUNT_CAP } from "./room-count-label";
import { useShowRoomUnreadCount } from "./use-show-room-unread-count";

/** What a room's row draws, by the reader's own preference for the count. */
export function useRoomRowAttention(room: ChatRoom) {
  const showUnreadCount = useShowRoomUnreadCount();
  return resolveRoomAttention({
    unreadCount: room.unreadCount,
    channelUnreadCount: room.channelUnreadCount,
    unreadMentionCount: room.unreadMentionCount,
    unreadNeedsYouCount: room.unreadNeedsYouCount,
    markedUnread: room.markedUnread,
    isMuted: room.mutedAt != null,
    showUnreadCount,
    badgeCountsMentions: roomBadgeCountsMentions(room),
  });
}

/**
 * The reader's opt-in Room unread count, as the link announces it.
 *
 * The number itself is drawn by `MentionBadge`, in the trailing cluster,
 * outside the link and `aria-hidden`. This span is what carries it into the
 * link's accessible name beside the room name, the way `MentionAnnouncement`
 * carries the badge.
 *
 * A bare `span` is role `generic`, which prohibits an accessible name, so an
 * `aria-label` here can be dropped. Real text carries it instead.
 */
export function RoomUnreadCount({ count }: { count: number }) {
  const t = useTranslations("App.Channels.RoomUnread");

  if (count <= 0) {
    return null;
  }

  return (
    <span className="sr-only">
      {count > ROOM_COUNT_CAP
        ? t("unreadMessagesCapped", { max: ROOM_COUNT_CAP })
        : t("unreadMessages", { count })}
    </span>
  );
}

/**
 * Unread @mentions and directs, never messages: the part the reader hears.
 *
 * `MentionBadge` draws the number in the trailing cluster, outside the link
 * and `aria-hidden`, so this span is what carries the mention into the link's
 * accessible name beside the room name. A translated string in its own
 * `sr-only` span, for the same reason the count carries one: `aria-label` on a
 * role `generic` span may be dropped, and an English literal would reach a
 * German or Spanish reader untranslated either way.
 */
export function MentionAnnouncement({ count }: { count: number }) {
  const t = useTranslations("App.Channels.RoomMentions");

  if (count <= 0) {
    return null;
  }

  return (
    <span className="sr-only">
      {count > ROOM_COUNT_CAP
        ? t("mentionsCapped", { max: ROOM_COUNT_CAP })
        : t("mentions", { count })}
    </span>
  );
}

/** The needs-you pill in words, for the same reason the mention has some. */
export function NeedsYouAnnouncement({ count }: { count: number }) {
  const t = useTranslations("App.Channels.Signals");

  if (count <= 0) {
    return null;
  }

  return <span className="sr-only">{t("needsYouCount", { count })}</span>;
}
