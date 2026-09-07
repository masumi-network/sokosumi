"use client";

import {
  isBrowserOnlyNotification,
  makeUserNotificationsChannelName,
} from "@sokosumi/utils";
import { ChannelProvider } from "ably/react";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { NotificationToastListener } from "@/app/components/notification-toast-listener";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { NotificationEventData } from "@/lib/ably";
import { useNotificationRealtime } from "@/lib/ably/use-notification-realtime";
import { notificationsBrowserClient } from "@/lib/clients/core.notifications.browser.client";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { NOTIFICATION_TOASTER_ID } from "@/lib/constants/notification-toaster";

function dismissNotificationToast(notificationId: string) {
  toast.dismiss(notificationId);
}

function dismissAllNotificationToasts() {
  for (const activeToast of toast.getToasts()) {
    if ("dismiss" in activeToast) {
      continue;
    }

    if (activeToast.toasterId === NOTIFICATION_TOASTER_ID) {
      toast.dismiss(activeToast.id);
    }
  }
}

interface NotificationContextValue {
  notifications: NotificationItem[];
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Drop a notification from local feed state (e.g. resolved vendor grant). */
  removeNotification: (id: string) => void;
  refetch: () => Promise<void>;
  isLoading: boolean;
  hasFetchError: boolean;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

const NOTIFICATION_LIST_LIMIT = 10;

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

  return [...pendingRealtime, ...fetched].slice(0, NOTIFICATION_LIST_LIMIT);
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
  const fetchedUnread = fetched.filter(
    (notification) => !notification.isRead,
  ).length;
  const localKnownUnread = fetchedUnread + pendingUnread;

  return Math.max(serverCount, localKnownUnread);
}

interface NotificationState {
  notifications: NotificationItem[];
  unreadCount: number;
}

type NotificationAction =
  | {
      type: "fetch_success";
      fetched: NotificationItem[];
      serverUnreadCount: number;
    }
  | { type: "realtime"; notification: NotificationItem; created: boolean }
  | {
      type: "mark_read_success";
      id: string;
      updated: NotificationItem;
    }
  | { type: "mark_read_optimistic"; id: string }
  | { type: "mark_all_read" }
  | { type: "remove"; id: string };

export function notificationReducer(
  state: NotificationState,
  action: NotificationAction,
): NotificationState {
  switch (action.type) {
    case "fetch_success": {
      // Browser-only rows never belong in local feed state; drop leaks so
      // mergeNotificationList cannot keep them as "pending realtime".
      const current = state.notifications.filter(
        (notification) => !isFeedExcluded(notification),
      );
      const fetched = action.fetched.filter(
        (notification) => !isFeedExcluded(notification),
      );

      return {
        notifications: mergeNotificationList(current, fetched),
        unreadCount: mergeUnreadCount(
          current,
          fetched,
          action.serverUnreadCount,
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

export function useNotifications() {
  const context = use(NotificationContext);
  if (!context) {
    throw new Error(
      "useNotifications must be used within NotificationProvider",
    );
  }
  return context;
}

async function noopAsync(): Promise<void> {}

function noopRemove(_id: string): void {}

const NOTIFICATION_FALLBACK_VALUE: NotificationContextValue = {
  notifications: [],
  unreadCount: 0,
  markRead: noopAsync,
  markAllRead: noopAsync,
  removeNotification: noopRemove,
  refetch: noopAsync,
  isLoading: true,
  hasFetchError: false,
};

interface NotificationFallbackProviderProps {
  children: React.ReactNode;
}

/**
 * Passive context for Instant Nav Suspense fallback chrome.
 * Same shape as NotificationProvider — no REST fetch, no Ably.
 */
export function NotificationFallbackProvider({
  children,
}: NotificationFallbackProviderProps) {
  return (
    <NotificationContext value={NOTIFICATION_FALLBACK_VALUE}>
      {children}
    </NotificationContext>
  );
}

interface NotificationProviderProps {
  userId: string;
  children: React.ReactNode;
}

function NotificationRealtimeBridge({
  userId,
  onNotification,
  onSubscribed,
}: {
  userId: string;
  onNotification: (notification: NotificationEventData) => void;
  onSubscribed: () => void;
}) {
  useNotificationRealtime({
    userId,
    onNotification,
    onError: (error) => {
      console.error("Ably notification error:", error);
    },
  });

  useMountEffect(() => {
    onSubscribed();
  });

  return null;
}

/**
 * Immediate path: reducer + REST fetch/mark-read + context + children.
 * Sibling island: LazyAbly → ChannelProvider → realtime bridge + toast listener
 * that dispatch into the same reducer. Children never wait on Ably.
 */
export function NotificationProvider({
  userId,
  children,
}: NotificationProviderProps) {
  const [{ notifications, unreadCount }, dispatch] = useReducer(
    notificationReducer,
    { notifications: [], unreadCount: 0 },
  );
  const [isLoading, setIsLoading] = useState(true);
  const [hasFetchError, setHasFetchError] = useState(false);
  const fetchGenerationRef = useRef(0);

  const fetchNotifications = useCallback(async () => {
    const generation = ++fetchGenerationRef.current;
    setIsLoading(true);

    try {
      const [listResponse, countResponse] = await Promise.all([
        notificationsBrowserClient.getNotifications({
          limit: NOTIFICATION_LIST_LIMIT,
        }),
        notificationsBrowserClient.getNotificationsUnreadCount(),
      ]);

      if (generation !== fetchGenerationRef.current) {
        return;
      }

      dispatch({
        type: "fetch_success",
        fetched: listResponse.data,
        serverUnreadCount: countResponse.data.count,
      });
      setHasFetchError(false);
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
      if (generation === fetchGenerationRef.current) {
        setHasFetchError(true);
      }
    } finally {
      if (generation === fetchGenerationRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const markAllRead = useCallback(async () => {
    // Paint read state immediately so mark-all-read clicks stay within good INP.
    dispatch({ type: "mark_all_read" });
    dismissAllNotificationToasts();

    try {
      await notificationsBrowserClient.patchNotificationsReadAll();
    } catch (error) {
      console.error("Failed to mark all notifications as read:", error);
      void fetchNotifications();
      throw error;
    }
  }, [fetchNotifications]);

  const markRead = useCallback(
    async (id: string) => {
      // Optimistic update paints before the network round-trip, which keeps
      // notification clicks from blocking Interaction to Next Paint.
      dispatch({ type: "mark_read_optimistic", id });
      dismissNotificationToast(id);

      try {
        const response = await notificationsBrowserClient.patchNotificationRead(
          { id },
        );

        dispatch({
          type: "mark_read_success",
          id,
          updated: response.data,
        });
      } catch (error) {
        console.error("Failed to mark notification as read:", error);
        void fetchNotifications();
        throw error;
      }
    },
    [fetchNotifications],
  );

  const removeNotification = useCallback((id: string) => {
    dispatch({ type: "remove", id });
    dismissNotificationToast(id);
  }, []);

  const handleNotificationEvent = useCallback(
    (notification: NotificationEventData) => {
      // Silenced in the app by the reader's preference matrix. It still arrives,
      // because an OS banner rides the same event.
      if (!notification.inApp) {
        return;
      }

      dispatch({
        type: "realtime",
        created: notification.created,
        notification: {
          ...notification,
          kind: notification.kind as NotificationItem["kind"],
          readAt: notification.readAt ? new Date(notification.readAt) : null,
          createdAt: new Date(notification.createdAt),
        },
      });
    },
    [],
  );

  const handleRealtimeSubscribed = useCallback(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  const value: NotificationContextValue = {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    removeNotification,
    refetch: fetchNotifications,
    isLoading,
    hasFetchError,
  };

  return (
    <NotificationContext value={value}>
      {children}
      <LazyAblyProvider>
        <ChannelProvider channelName={makeUserNotificationsChannelName(userId)}>
          <NotificationRealtimeBridge
            userId={userId}
            onNotification={handleNotificationEvent}
            onSubscribed={handleRealtimeSubscribed}
          />
          <NotificationToastListener userId={userId} markRead={markRead} />
        </ChannelProvider>
      </LazyAblyProvider>
    </NotificationContext>
  );
}
