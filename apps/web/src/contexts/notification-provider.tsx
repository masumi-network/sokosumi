"use client";

import { createContext, use, useCallback, useEffect, useState } from "react";
import type { NotificationEventData } from "@/lib/ably";
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

export function NotificationProvider({
  userId,
  children,
}: NotificationProviderProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    try {
      const [listResponse, countResponse] = await Promise.all([
        coreClient.getNotifications({ limit: 10 }),
        coreClient.getNotificationsUnreadCount(),
      ]);

      setNotifications(listResponse.data);
      setUnreadCount(countResponse.data.count);
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const markRead = useCallback(async (id: string) => {
    let wasUnread = false;
    setNotifications((prev) => {
      wasUnread = prev.some(
        (notification) => notification.id === id && !notification.isRead,
      );
      return prev;
    });

    try {
      const response = await coreClient.patchNotificationRead({ id });
      const updatedNotification = response.data;

      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? updatedNotification : n)),
      );

      if (wasUnread && updatedNotification.isRead) {
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

        return [convertedNotification, ...prev].slice(0, 10);
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
