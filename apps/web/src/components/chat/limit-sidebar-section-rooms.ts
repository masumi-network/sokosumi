import {
  type ChatRoomActivitySortKey,
  compareChatRoomTimestamps,
} from "./chat-room-activity-sort";

/** Rooms a sidebar section lists before "Show more". */
export const SIDEBAR_SECTION_ROOM_LIMIT = 5;

export interface LimitedSectionRooms<T> {
  visible: T[];
  /** Rooms the limit leaves out; zero means the section needs no toggle. */
  hiddenCount: number;
}

interface SectionLimitOptions<T> {
  showAll: boolean;
  alwaysShow: (room: T) => boolean;
  limit?: number;
}

/**
 * The rooms a sidebar section lists, in their own order: the first `limit`,
 * plus every room `alwaysShow` keeps (unread, or open) wherever it sits, so
 * nothing new ever waits behind "Show more". Hiding a single room would trade
 * its row for a toggle row of the same height, so a section one over the
 * limit lists everything.
 */
export function limitSidebarSectionRooms<T>(
  rooms: readonly T[],
  options: SectionLimitOptions<T>,
): LimitedSectionRooms<T> {
  const limit = options.limit ?? SIDEBAR_SECTION_ROOM_LIMIT;
  const limited = rooms.filter(
    (room, index) => index < limit || options.alwaysShow(room),
  );
  return resolveSectionLimit(rooms, limited, options.showAll);
}

export function limitSidebarChannels<T extends ChatRoomActivitySortKey>(
  rooms: readonly T[],
  options: SectionLimitOptions<T>,
): LimitedSectionRooms<T> {
  const limit = options.limit ?? SIDEBAR_SECTION_ROOM_LIMIT;
  const recent = rooms.toSorted(compareChatRoomTimestamps);
  const publicRooms = recent.filter(
    (room) => room.discoverability !== "private",
  );
  const privateRooms = recent.filter(
    (room) => room.discoverability === "private",
  );

  // Reserve half for each group, then fill any spare places by activity.
  const half = Math.floor(limit / 2);
  const selected = new Set([
    ...publicRooms.slice(0, half),
    ...privateRooms.slice(0, half),
  ]);
  for (const room of recent) {
    if (selected.size >= limit) break;
    selected.add(room);
  }

  const grouped = [...publicRooms, ...privateRooms];
  const limited = grouped.filter(
    (room) => selected.has(room) || options.alwaysShow(room),
  );
  return resolveSectionLimit(rooms, limited, options.showAll);
}

function resolveSectionLimit<T>(
  rooms: readonly T[],
  limited: T[],
  showAll: boolean,
): LimitedSectionRooms<T> {
  const hiddenCount = rooms.length - limited.length;
  if (hiddenCount <= 1) {
    return { visible: [...rooms], hiddenCount: 0 };
  }
  return {
    visible: showAll ? [...rooms] : limited,
    hiddenCount,
  };
}
