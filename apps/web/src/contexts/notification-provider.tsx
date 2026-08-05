"use client";

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
import {
  makeUserNotificationsChannelName,
  type NotificationEventData,
} from "@/lib/ably";
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
  refetch: () => Promise<void>;
  isLoading: boolean;
  hasFetchError: boolean;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

const NOTIFICATION_LIST_LIMIT = 10;

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
  | { type: "realtime"; notification: NotificationItem }
  | {
      type: "mark_read_success";
      id: string;
      updated: NotificationItem;
    }
  | { type: "mark_read_optimistic"; id: string }
  | { type: "mark_all_read" };

export function notificationReducer(
  state: NotificationState,
  action: NotificationAction,
): NotificationState {
  switch (action.type) {
    case "fetch_success": {
      // CHAT is browser-OS only; drop any that already leaked into local state
      // so mergeNotificationList cannot keep them as "pending realtime".
      const current = state.notifications.filter(
        (notification) => notification.kind !== "CHAT",
      );
      const fetched = action.fetched.filter(
        (notification) => notification.kind !== "CHAT",
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

      // CHAT is browser-OS only; room attention uses a separate path.
      if (convertedNotification.kind === "CHAT") {
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

        return {
          notifications: state.notifications.map((notification) =>
            notification.id === convertedNotification.id
              ? convertedNotification
              : notification,
          ),
          unreadCount,
        };
      }

      return {
        notifications: [convertedNotification, ...state.notifications].slice(
          0,
          NOTIFICATION_LIST_LIMIT,
        ),
        unreadCount: convertedNotification.isRead
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
      // CHAT is browser-OS only and never counted in the in-app badge.
      // Toast click still calls markRead for room attention; ignore feed state.
      if (action.updated.kind === "CHAT") {
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

  const handleNotificationEvent = useCallback(
    (notification: NotificationEventData) => {
      dispatch({
        type: "realtime",
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
