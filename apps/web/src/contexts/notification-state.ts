import { isBrowserOnlyNotification } from "@sokosumi/utils";
import type { NotificationItem } from "@/lib/clients/generated/core";

export const NOTIFICATION_LIST_LIMIT = 10;

/** The order the feed reads in: newest first, and by id when they tie. */
function byNewestFirst(a: NotificationItem, b: NotificationItem): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();

  return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
}

/**
 * Whether this row belongs to a surface other than the notification center.
 *
 * The kind alone stopped answering it once a chat room message started
 * reaching the feed, so the message key is asked as well, in the one place
 * both apps read it from.
 */
function isFeedExcluded(notification: NotificationItem): boolean {
  return isBrowserOnlyNotification(notification.kind, notification.messageKey);
}

function mergeNotificationList(
  current: NotificationItem[],
  fetched: NotificationItem[],
): NotificationItem[] {
  const fetchedIds = new Set(fetched.map((notification) => notification.id));
  const pendingRealtime = current.filter(
    (notification) => !fetchedIds.has(notification.id),
  );
  const currentById = new Map(
    current.map((notification) => [notification.id, notification]),
  );

  return [
    ...pendingRealtime,
    ...fetched.map(
      (notification) => currentById.get(notification.id) ?? notification,
    ),
  ]
    .sort(byNewestFirst)
    .slice(0, NOTIFICATION_LIST_LIMIT);
}

function mergeUnreadCount(
  current: NotificationItem[],
  fetched: NotificationItem[],
  serverCount: number,
): number {
  const fetchedIds = new Set(fetched.map((notification) => notification.id));
  const pendingUnread = current.filter(
    (notification) => !fetchedIds.has(notification.id) && !notification.isRead,
  ).length;
  const currentById = new Map(
    current.map((notification) => [notification.id, notification]),
  );
  const fetchedUnread = fetched.filter(
    (notification) =>
      !(currentById.get(notification.id) ?? notification).isRead,
  ).length;
  const localKnownUnread = fetchedUnread + pendingUnread;

  return Math.max(serverCount, localKnownUnread);
}

export interface NotificationState {
  notifications: NotificationItem[];
  unreadCount: number;
}

export type NotificationAction =
  | {
      type: "fetch_success";
      fetched: NotificationItem[];
      serverUnreadCount: number;
      realtimeIds: ReadonlySet<string>;
    }
  | { type: "realtime"; notification: NotificationItem; created: boolean }
  | {
      type: "mark_read_success";
      id: string;
      updated: NotificationItem;
    }
  | { type: "mark_read_optimistic"; id: string }
  | { type: "mark_all_read" }
  | { type: "remove"; id: string }
  | { type: "unread_deleted"; id: string }
  | { type: "clear_all" };

export function notificationReducer(
  state: NotificationState,
  action: NotificationAction,
): NotificationState {
  switch (action.type) {
    case "fetch_success": {
      // Only events received during this request can supersede its snapshot.
      // Rows already present before the request may have been deleted elsewhere.
      const current = state.notifications.filter(
        (notification) =>
          action.realtimeIds.has(notification.id) &&
          !isFeedExcluded(notification),
      );
      const fetched = action.fetched.filter(
        (notification) => !isFeedExcluded(notification),
      );

      const readStateChanged = current.some((notification) =>
        fetched.some(
          (row) =>
            row.id === notification.id && row.isRead !== notification.isRead,
        ),
      );

      return {
        notifications: mergeNotificationList(current, fetched),
        unreadCount: mergeUnreadCount(
          current,
          fetched,
          readStateChanged ? state.unreadCount : action.serverUnreadCount,
        ),
      };
    }
    case "realtime": {
      const convertedNotification = action.notification;

      // Browser-OS only; room attention uses a separate path.
      if (isFeedExcluded(convertedNotification)) {
        return state;
      }

      const existing = state.notifications.find(
        (notification) => notification.id === convertedNotification.id,
      );

      if (existing) {
        const wasUnread = !existing.isRead;
        const isUnread = !convertedNotification.isRead;
        let unreadCount = state.unreadCount;

        if (wasUnread && !isUnread) {
          unreadCount = Math.max(0, unreadCount - 1);
        } else if (!wasUnread && isUnread) {
          unreadCount = unreadCount + 1;
        }

        // Sorted rather than replaced in place. A room's row moves to the
        // top of the feed when a message counts onto it, and a list that kept
        // it where it was would disagree with the order the next read
        // returns: the same rows, in a different order, for no reason the
        // reader can see.
        return {
          notifications: state.notifications
            .map((notification) =>
              notification.id === convertedNotification.id
                ? convertedNotification
                : notification,
            )
            .sort(byNewestFirst),
          unreadCount,
        };
      }

      // An unseen read update only confirms server state. Adding its old row
      // would put it at the front and displace a newer notification.
      if (!action.created && convertedNotification.isRead) {
        return state;
      }

      // A row this list does not hold is either new, or one the list never
      // reached: the reader has more unread rows than the window keeps, and a
      // room's later messages arrive as changes to a row written earlier.
      // Counting the second kind would put the badge one ahead of the server
      // for the rest of the session.
      return {
        notifications: [convertedNotification, ...state.notifications].slice(
          0,
          NOTIFICATION_LIST_LIMIT,
        ),
        unreadCount:
          convertedNotification.isRead || !action.created
            ? state.unreadCount
            : state.unreadCount + 1,
      };
    }
    case "mark_read_optimistic": {
      const existing = state.notifications.find(
        (notification) => notification.id === action.id,
      );

      if (!existing || existing.isRead) {
        return state;
      }

      const readAt = new Date();

      return {
        notifications: state.notifications.map((notification) =>
          notification.id === action.id
            ? { ...notification, isRead: true, readAt }
            : notification,
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      };
    }
    case "mark_read_success": {
      // Browser-only rows are never counted in the in-app badge. Toast click
      // still calls markRead for room attention; ignore feed state.
      if (isFeedExcluded(action.updated)) {
        return state;
      }

      const existing = state.notifications.find(
        (notification) => notification.id === action.id,
      );
      const shouldDecrementUnread = existing ? !existing.isRead : true;

      return {
        notifications: state.notifications.map((notification) =>
          notification.id === action.id ? action.updated : notification,
        ),
        unreadCount:
          shouldDecrementUnread && action.updated.isRead
            ? Math.max(0, state.unreadCount - 1)
            : state.unreadCount,
      };
    }
    case "remove": {
      const existing = state.notifications.find(
        (notification) => notification.id === action.id,
      );

      if (!existing) {
        return state;
      }

      return {
        notifications: state.notifications.filter(
          (notification) => notification.id !== action.id,
        ),
        unreadCount: existing.isRead
          ? state.unreadCount
          : Math.max(0, state.unreadCount - 1),
      };
    }
    case "unread_deleted": {
      // An unread row this list never held is gone. The badge counted it, so
      // take it off without touching the rows that are here.
      return {
        notifications: state.notifications,
        unreadCount: Math.max(0, state.unreadCount - 1),
      };
    }
    case "clear_all": {
      return { notifications: [], unreadCount: 0 };
    }
    case "mark_all_read": {
      const readAt = new Date();

      return {
        notifications: state.notifications.map((notification) =>
          notification.isRead
            ? notification
            : { ...notification, isRead: true, readAt },
        ),
        unreadCount: 0,
      };
    }
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
