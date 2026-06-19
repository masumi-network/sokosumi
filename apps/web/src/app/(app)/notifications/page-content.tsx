"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/contexts/notification-provider";
import { coreClient } from "@/lib/clients/core.browser.client";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getNotificationHref } from "@/lib/utils/notification-href";
import { useNotificationMessage } from "@/lib/utils/notification-message";
import { formatNotificationTime } from "@/lib/utils/notification-time";

interface NotificationsPageContentProps {
  userId: string;
}

export function NotificationsPageContent({
  userId: _userId,
}: NotificationsPageContentProps) {
  const tCenter = useTranslations("Components.NotificationCenter");
  const formatMessage = useNotificationMessage();
  const { markRead } = useNotifications();
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);

  const fetchNotifications = useCallback(async (nextCursor?: string | null) => {
    try {
      setIsLoading(true);
      const response = await coreClient.getNotifications({
        limit: 20,
        cursor: nextCursor ?? undefined,
      });

      setNotifications((prev) =>
        nextCursor ? [...prev, ...response.data] : response.data,
      );
      const paginationMeta = response.meta.pagination;
      setHasMore(paginationMeta.nextCursor !== null);
      setCursor(paginationMeta.nextCursor);
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  const handleNotificationClick = async (notification: NotificationItem) => {
    if (!notification.isRead) {
      try {
        await markRead(notification.id);

        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, isRead: true } : n,
          ),
        );
      } catch (error) {
        console.error("Failed to mark notification as read:", error);
      }
    }

    const href = getNotificationHref({
      kind: notification.kind,
      referenceId: notification.referenceId,
      metadata: notification.metadata,
    });

    router.push(href);
  };

  const handleLoadMore = () => {
    void fetchNotifications(cursor);
  };

  if (isLoading && notifications.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{tCenter("pageTitle")}</h1>
        <div className="divide-border bg-card divide-y rounded-lg border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 p-4">
              <div className="bg-muted h-4 w-3/4 animate-pulse rounded" />
              <div className="bg-muted h-3 w-1/4 animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{tCenter("pageTitle")}</h1>
        <div className="bg-card flex flex-col items-center justify-center rounded-lg border p-8">
          <p className="text-muted-foreground text-center">
            {tCenter("emptyState")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{tCenter("pageTitle")}</h1>
      <div className="divide-border bg-card divide-y rounded-lg border">
        {notifications.map((notification) => {
          const message = formatMessage(
            notification.messageKey,
            notification.messageParams ?? {},
          );

          return (
            <button
              key={notification.id}
              type="button"
              className={cn(
                "hover:bg-accent flex w-full cursor-pointer flex-col gap-2 p-4 text-left transition-colors",
                !notification.isRead && "bg-accent/50",
              )}
              onClick={() => handleNotificationClick(notification)}
            >
              <div className="flex items-start justify-between gap-2">
                <p
                  className={cn(
                    "text-sm",
                    !notification.isRead && "font-medium",
                  )}
                >
                  {message}
                </p>
                {!notification.isRead ? (
                  <span className="bg-green-500 mt-1.5 size-2 shrink-0 rounded-full" />
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs">
                {formatNotificationTime(notification.createdAt)}
              </p>
            </button>
          );
        })}
      </div>
      {hasMore ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={isLoading}
          >
            {isLoading ? tCenter("loading") : tCenter("loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
