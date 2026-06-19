"use client";

import { ChannelProvider } from "ably/react";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  makeUserNotificationsChannelName,
  type NotificationEventData,
} from "@/lib/ably";
import { useNotificationRealtime } from "@/lib/ably/use-notification-realtime";
import { coreClient } from "@/lib/clients/core.browser.client";
import type { NotificationItem } from "@/lib/clients/generated/core";

interface NotificationContextValue {
  notifications: NotificationItem[];
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
  isLoading: boolean;
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

  return serverCount + pendingUnread;
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

function NotificationProviderBody({
  userId,
  children,
}: NotificationProviderProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const fetchGenerationRef = useRef(0);

  const fetchNotifications = useCallback(async () => {
    const generation = ++fetchGenerationRef.current;

    try {
      const [listResponse, countResponse] = await Promise.all([
        coreClient.getNotifications({ limit: NOTIFICATION_LIST_LIMIT }),
        coreClient.getNotificationsUnreadCount(),
      ]);

      if (generation !== fetchGenerationRef.current) {
        return;
      }

      setNotifications((prev) => {
        const merged = mergeNotificationList(prev, listResponse.data);
        setUnreadCount(
          mergeUnreadCount(prev, listResponse.data, countResponse.data.count),
        );
        return merged;
      });
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      if (generation === fetchGenerationRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const markRead = useCallback(async (id: string) => {
    let shouldDecrementUnread = false;
    setNotifications((prev) => {
      const existing = prev.find((notification) => notification.id === id);
      shouldDecrementUnread = existing ? !existing.isRead : true;
      return prev;
    });

    try {
      const response = await coreClient.patchNotificationRead({ id });
      const updatedNotification = response.data;

      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? updatedNotification : n)),
      );

      if (shouldDecrementUnread && updatedNotification.isRead) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
      throw error;
    }
  }, []);

  const handleNotificationEvent = useCallback(
    (notification: NotificationEventData) => {
      const convertedNotification: NotificationItem = {
        ...notification,
        kind: notification.kind as NotificationItem["kind"],
        readAt: notification.readAt ? new Date(notification.readAt) : null,
        createdAt: new Date(notification.createdAt),
      };

      setNotifications((prev) => {
        const existing = prev.find((n) => n.id === convertedNotification.id);
        if (existing) {
          const wasUnread = !existing.isRead;
          const isUnread = !convertedNotification.isRead;

          if (wasUnread !== isUnread) {
            setUnreadCount((count) =>
              isUnread ? count + 1 : Math.max(0, count - 1),
            );
          }

          return prev.map((n) =>
            n.id === convertedNotification.id ? convertedNotification : n,
          );
        }

        if (!convertedNotification.isRead) {
          setUnreadCount((count) => count + 1);
        }

        return [convertedNotification, ...prev].slice(
          0,
          NOTIFICATION_LIST_LIMIT,
        );
      });
    },
    [],
  );

  useNotificationRealtime({
    userId,
    onNotification: handleNotificationEvent,
    onError: (error) => {
      console.error("Ably notification error:", error);
    },
  });

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  const value: NotificationContextValue = {
    notifications,
    unreadCount,
    markRead,
    refetch: fetchNotifications,
    isLoading,
  };

  return <NotificationContext value={value}>{children}</NotificationContext>;
}

export function NotificationProvider({
  userId,
  children,
}: NotificationProviderProps) {
  return (
    <ChannelProvider channelName={makeUserNotificationsChannelName(userId)}>
      <NotificationProviderBody userId={userId}>
        {children}
      </NotificationProviderBody>
    </ChannelProvider>
  );
}
