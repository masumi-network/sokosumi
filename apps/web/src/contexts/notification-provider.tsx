"use client";

import { createContext, use, useCallback, useEffect, useState } from "react";
import type { NotificationEventData } from "@/lib/ably";
import { useNotificationRealtime } from "@/lib/ably/use-notification-realtime";
import { coreClient } from "@/lib/clients/core.client.browser";
import type { components } from "@/lib/clients/generated/core/types";

type NotificationItem = components["schemas"]["NotificationItem"];

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
        coreClient.GET("/v1/notifications", {
          params: { query: { limit: 10 } },
        }),
        coreClient.GET("/v1/notifications/unread-count"),
      ]);

      if (listResponse.data) {
        setNotifications(listResponse.data.data);
      }
      if (countResponse.data) {
        setUnreadCount(countResponse.data.data.count);
      }
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const markRead = useCallback(async (id: string) => {
    try {
      const response = await coreClient.PATCH("/v1/notifications/{id}/read", {
        params: { path: { id } },
      });

      if (response.data) {
        const updatedNotification = response.data.data;
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? updatedNotification : n)),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  }, []);

  const handleNotificationEvent = useCallback(
    (notification: NotificationEventData) => {
      setNotifications((prev) => {
        const exists = prev.some((n) => n.id === notification.id);
        if (exists) {
          return prev.map((n) => (n.id === notification.id ? notification : n));
        }
        return [notification, ...prev].slice(0, 10);
      });

      if (!notification.isRead) {
        setUnreadCount((prev) => prev + 1);
      }
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
