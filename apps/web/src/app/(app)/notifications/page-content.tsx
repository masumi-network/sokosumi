"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/contexts/notification-provider";
import { coreClient } from "@/lib/clients/core.browser.client";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getNotificationHref } from "@/lib/utils/notification-href";
import { useNotificationMessage } from "@/lib/utils/notification-message";
import { useNotificationTimeFormatter } from "@/lib/utils/notification-time";

interface NotificationsPageContentProps {
  userId: string;
}

export function NotificationsPageContent({
  userId: _userId,
}: NotificationsPageContentProps) {
  const tCenter = useTranslations("Components.NotificationCenter");
  const formatMessage = useNotificationMessage();
  const formatTime = useNotificationTimeFormatter();
  const {
    markRead,
    markAllRead,
    notifications: providerNotifications,
    unreadCount,
  } = useNotifications();
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
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

  useEffect(() => {
    setNotifications((prev) => {
      const providerById = new Map(
        providerNotifications.map((notification) => [
          notification.id,
          notification,
        ]),
      );
      let changed = false;
      let next = prev.map((notification) => {
        const updated = providerById.get(notification.id);
        if (
          updated &&
          (updated.isRead !== notification.isRead ||
            updated.readAt !== notification.readAt)
        ) {
          changed = true;
          return updated;
        }
        return notification;
      });

      const prevIds = new Set(prev.map((notification) => notification.id));
      const newItems = providerNotifications.filter(
        (notification) => !prevIds.has(notification.id),
      );
      if (newItems.length > 0) {
        changed = true;
        next = [...newItems, ...next];
      }

      return changed ? next : prev;
    });
  }, [providerNotifications]);

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
        return;
      }
    }

    const href = getNotificationHref({
      kind: notification.kind,
      referenceId: notification.referenceId,
      metadata: notification.metadata,
    });

    router.push(href);
  };

  const handleMarkAllRead = async () => {
    if (isMarkingAllRead) return;

    setIsMarkingAllRead(true);
    try {
      await markAllRead();
      setNotifications((prev) =>
        prev.map((notification) =>
          notification.isRead
            ? notification
            : { ...notification, isRead: true, readAt: new Date() },
        ),
      );
    } catch {
      toast.error(tCenter("markAllReadError"));
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const handleLoadMore = () => {
    void fetchNotifications(cursor);
  };

  return (
    <div className="flex flex-col gap-5 pb-4">
      {unreadCount > 0 ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            className="self-start"
            onClick={() => void handleMarkAllRead()}
            disabled={isMarkingAllRead}
          >
            {isMarkingAllRead ? tCenter("loading") : tCenter("markAllRead")}
          </Button>
        </div>
      ) : null}

      {isLoading && notifications.length === 0 ? (
        <div className="bg-muted/30 border-border/50 overflow-hidden rounded-xl border">
          <div className="divide-border/50 divide-y">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2 p-4">
                <div className="bg-muted h-4 w-3/4 animate-pulse rounded" />
                <div className="bg-muted h-3 w-1/4 animate-pulse rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : notifications.length === 0 ? (
        <div className="bg-muted/30 border-border/50 flex flex-col items-center justify-center rounded-xl border p-8">
          <p className="text-muted-foreground text-center">
            {tCenter("emptyState")}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-muted/30 border-border/50 overflow-hidden rounded-xl border">
            <div className="divide-border/50 divide-y">
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
                      "hover:bg-accent flex w-full cursor-pointer p-4 text-left transition-colors",
                      !notification.isRead && "bg-accent/50",
                    )}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex w-full items-start gap-3">
                      <Bell
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          notification.isRead
                            ? "text-muted-foreground"
                            : "text-primary",
                        )}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p
                          className={cn(
                            "text-sm",
                            !notification.isRead && "font-medium",
                          )}
                        >
                          {message}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatTime(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
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
        </>
      )}
    </div>
  );
}
