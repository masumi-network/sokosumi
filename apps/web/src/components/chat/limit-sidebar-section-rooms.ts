/** Rooms a sidebar section lists before "Show more". */
export const SIDEBAR_SECTION_ROOM_LIMIT = 5;

export interface LimitedSectionRooms<T> {
  visible: T[];
  /** Rooms the limit leaves out; zero means the section needs no toggle. */
  hiddenCount: number;
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
  options: {
    showAll: boolean;
    alwaysShow: (room: T) => boolean;
    limit?: number;
  },
): LimitedSectionRooms<T> {
  const limit = options.limit ?? SIDEBAR_SECTION_ROOM_LIMIT;
  const limited = rooms.filter(
    (room, index) => index < limit || options.alwaysShow(room),
  );
  const hiddenCount = rooms.length - limited.length;
  if (hiddenCount <= 1) {
    return { visible: [...rooms], hiddenCount: 0 };
  }
  return {
    visible: options.showAll ? [...rooms] : limited,
    hiddenCount,
  };
}
