import {
  isBrowserOnlyNotification,
  isMentionNotification,
  isNeedsActionNotification,
} from "@sokosumi/utils";
import type { NotificationItem } from "@/lib/clients/generated/core";

/** Rows per request, in the panel and on the page alike. Core's own default. */
export const NOTIFICATION_PAGE_SIZE = 20;

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
  kept: NotificationItem[],
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
    ...kept.filter((notification) => !fetchedIds.has(notification.id)),
  ].sort(byNewestFirst);
}

function isMention(notification: NotificationItem): boolean {
  return isMentionNotification(notification.messageKey);
}

/** What a change to one row's read state does to the Mentions count. */
function mentionsDelta(notification: NotificationItem, delta: number): number {
  return isMention(notification) ? delta : 0;
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

/**
 * Which rows the Notification Center shows: everything, only what is still
 * unread, only what still needs the reader, or only where someone named the
 * reader. A lens over the shared list: it never marks anything read.
 */
export type NotificationCenterView =
  | "all"
  | "unread"
  | "needs-action"
  | "mentions";

/**
 * Whether a row the list already holds still belongs under `view`, as far as
 * the list can tell on its own. All keeps everything; Unread keeps unread
 * rows; Needs you keeps rows that asked, because whether they are still
 * asking is Core's to say on the next fetch; Mentions keeps mentions.
 */
function belongsToView(
  view: NotificationCenterView,
  notification: NotificationItem,
): boolean {
  switch (view) {
    case "all":
      return true;
    case "unread":
      return !notification.isRead;
    case "needs-action":
      return isNeedsActionNotification(notification.messageKey);
    case "mentions":
      return isMention(notification);
    default: {
      const _exhaustive: never = view;
      void _exhaustive;
      return true;
    }
  }
}

export interface NotificationState {
  notifications: NotificationItem[];
  unreadCount: number;
  /** Rows whose request still waits on the reader. Core's number, as of the last fetch. */
  needsActionCount: number;
  /** Unread mentions. Core's number on a fetch, moved by reads in between. */
  mentionsCount: number;
}

export type NotificationAction =
  | {
      type: "fetch_success";
      fetched: NotificationItem[];
      serverUnreadCount: number;
      serverNeedsActionCount: number;
      serverMentionsCount: number;
      realtimeIds: ReadonlySet<string>;
      /** Whether Core has rows older than this page, which decides what the
          page is allowed to speak for. */
      hasMore: boolean;
      /** The view the page was fetched for: rows kept below it must still
          belong to it. */
      view: NotificationCenterView;
    }
  | { type: "load_older_success"; fetched: NotificationItem[] }
  | { type: "realtime"; notification: NotificationItem; created: boolean }
  | {
      type: "mark_read_success";
      id: string;
      updated: NotificationItem;
    }
  | { type: "mark_read_optimistic"; id: string }
  | { type: "mark_unread_optimistic"; id: string }
  | {
      type: "mark_unread_success";
      id: string;
      updated: NotificationItem;
    }
  | { type: "mark_all_read" }
  | { type: "remove"; id: string }
  | { type: "reset_list" };

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

      // The page speaks for the range it covers and nothing beyond it. Rows
      // older than its last row came from pages the reader scrolled to, and
      // are still there; rows inside the range that it did not return are
      // gone from the feed, which is how a resolved access request leaves.
      //
      // Only when the page reaches them, though. A page whose last row this
      // list never held ends above everything loaded, because more rows
      // arrived than a page holds while nothing was listening, and keeping
      // the old rows would leave the ones between out for good. The list
      // starts over from the page instead, and scrolling brings the rest.
      // A page with nothing after it covers the feed to its end, so there is
      // no "beyond" left to keep either way.
      const oldestFetched = fetched.at(-1);
      const reachesLoadedRows =
        oldestFetched !== undefined &&
        state.notifications.some((row) => row.id === oldestFetched.id);
      const kept =
        action.hasMore && oldestFetched && reachesLoadedRows
          ? state.notifications.filter(
              (notification) =>
                !isFeedExcluded(notification) &&
                belongsToView(action.view, notification) &&
                byNewestFirst(notification, oldestFetched) > 0,
            )
          : [];

      // A row read while the request was out makes Core's number stale.
      // Each count asks only about its own rows, so a job read mid-fetch
      // does not hold the Mentions count at its local value.
      const changedDuringFetch = current.filter((notification) =>
        fetched.some(
          (row) =>
            row.id === notification.id && row.isRead !== notification.isRead,
        ),
      );
      const readStateChanged = changedDuringFetch.length > 0;
      const mentionReadStateChanged = changedDuringFetch.some(isMention);

      return {
        notifications: mergeNotificationList(current, fetched, kept),
        unreadCount: mergeUnreadCount(
          current,
          fetched,
          readStateChanged ? state.unreadCount : action.serverUnreadCount,
        ),
        needsActionCount: action.serverNeedsActionCount,
        mentionsCount: mergeUnreadCount(
          current.filter(isMention),
          fetched.filter(isMention),
          mentionReadStateChanged
            ? state.mentionsCount
            : action.serverMentionsCount,
        ),
      };
    }
    case "load_older_success": {
      // The badge counts the whole feed already, so reaching further back
      // into it adds nothing. A row the list holds wins over its older copy:
      // it may carry a read the reader has just made.
      const held = new Set(
        state.notifications.map((notification) => notification.id),
      );
      const older = action.fetched.filter(
        (notification) =>
          !held.has(notification.id) && !isFeedExcluded(notification),
      );

      if (older.length === 0) {
        return state;
      }

      return {
        ...state,
        notifications: [...state.notifications, ...older].sort(byNewestFirst),
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
        const delta = Number(isUnread) - Number(wasUnread);
        const unreadCount = Math.max(0, state.unreadCount + delta);
        const mentionsCount = Math.max(
          0,
          state.mentionsCount + mentionsDelta(convertedNotification, delta),
        );

        // Sorted rather than replaced in place. A room's row moves to the
        // top of the feed when a message counts onto it, and a list that kept
        // it where it was would disagree with the order the next read
        // returns: the same rows, in a different order, for no reason the
        // reader can see.
        return {
          ...state,
          notifications: state.notifications
            .map((notification) =>
              notification.id === convertedNotification.id
                ? convertedNotification
                : notification,
            )
            .sort(byNewestFirst),
          unreadCount,
          mentionsCount,
        };
      }

      // An unseen read update only confirms server state. Adding its old row
      // would put it at the front and displace a newer notification.
      if (!action.created && convertedNotification.isRead) {
        return state;
      }

      // A row put back to unread elsewhere keeps its own time, which can sort
      // it past the end of what this list has loaded. Held there, it would be
      // the row the next page starts from, and every row between would never
      // load. Paging reaches it in its turn, with its state as it is then.
      const oldestLoaded = state.notifications.at(-1);
      if (
        !action.created &&
        oldestLoaded &&
        byNewestFirst(convertedNotification, oldestLoaded) > 0
      ) {
        return state;
      }

      // A row this list does not hold is either new, or one the list never
      // reached: the reader has more unread rows than the window keeps, and a
      // room's later messages arrive as changes to a row written earlier.
      // Counting the second kind would put the badge one ahead of the server
      // for the rest of the session.
      return {
        ...state,
        notifications: [convertedNotification, ...state.notifications].sort(
          byNewestFirst,
        ),
        unreadCount:
          convertedNotification.isRead || !action.created
            ? state.unreadCount
            : state.unreadCount + 1,
        mentionsCount:
          convertedNotification.isRead || !action.created
            ? state.mentionsCount
            : state.mentionsCount + mentionsDelta(convertedNotification, 1),
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
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.id === action.id
            ? { ...notification, isRead: true, readAt }
            : notification,
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
        mentionsCount: Math.max(
          0,
          state.mentionsCount + mentionsDelta(existing, -1),
        ),
      };
    }
    case "mark_unread_optimistic": {
      const existing = state.notifications.find(
        (notification) => notification.id === action.id,
      );

      if (!existing || !existing.isRead) {
        return state;
      }

      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.id === action.id
            ? { ...notification, isRead: false, readAt: null }
            : notification,
        ),
        unreadCount: state.unreadCount + 1,
        mentionsCount: state.mentionsCount + mentionsDelta(existing, 1),
      };
    }
    case "mark_unread_success": {
      // Browser-only rows never reach the in-app badge, so a row the feed
      // excludes must not add to it here either.
      if (isFeedExcluded(action.updated)) {
        return state;
      }

      const existing = state.notifications.find(
        (notification) => notification.id === action.id,
      );

      // The optimistic pass already counted it. Only a row this list did not
      // hold as read still owes the badge a count.
      const shouldIncrementUnread = existing ? existing.isRead : false;

      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.id === action.id ? action.updated : notification,
        ),
        unreadCount:
          shouldIncrementUnread && !action.updated.isRead
            ? state.unreadCount + 1
            : state.unreadCount,
        mentionsCount:
          shouldIncrementUnread && !action.updated.isRead
            ? state.mentionsCount + mentionsDelta(action.updated, 1)
            : state.mentionsCount,
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
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.id === action.id ? action.updated : notification,
        ),
        unreadCount:
          shouldDecrementUnread && action.updated.isRead
            ? Math.max(0, state.unreadCount - 1)
            : state.unreadCount,
        mentionsCount:
          shouldDecrementUnread && action.updated.isRead
            ? Math.max(
                0,
                state.mentionsCount + mentionsDelta(action.updated, -1),
              )
            : state.mentionsCount,
      };
    }
    case "remove": {
      const existing = state.notifications.find(
        (notification) => notification.id === action.id,
      );

      if (!existing) {
        return state;
      }

      // A grant or access request answered in place leaves the feed. The
      // Needs you number is that view's live count, so it drops here the
      // same way unread does, rather than waiting for the next fetch.
      return {
        ...state,
        notifications: state.notifications.filter(
          (notification) => notification.id !== action.id,
        ),
        unreadCount: existing.isRead
          ? state.unreadCount
          : Math.max(0, state.unreadCount - 1),
        needsActionCount: isNeedsActionNotification(existing.messageKey)
          ? Math.max(0, state.needsActionCount - 1)
          : state.needsActionCount,
        mentionsCount: existing.isRead
          ? state.mentionsCount
          : Math.max(0, state.mentionsCount + mentionsDelta(existing, -1)),
      };
    }
    case "reset_list": {
      if (state.notifications.length === 0) {
        return state;
      }

      return { ...state, notifications: [] };
    }
    case "mark_all_read": {
      const readAt = new Date();

      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.isRead
            ? notification
            : { ...notification, isRead: true, readAt },
        ),
        unreadCount: 0,
        mentionsCount: 0,
      };
    }
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
