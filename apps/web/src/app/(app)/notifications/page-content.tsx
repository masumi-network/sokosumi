"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AccountNoticeRow } from "@/app/components/account-notice-row";
import { NotificationActorAvatar } from "@/app/components/notification-actor-avatar";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { Button } from "@/components/ui/button";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useNotifications } from "@/contexts/notification-provider";
import { useSession } from "@/lib/auth/auth.client";
import { coreClient } from "@/lib/clients/core.browser.client";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { useNotificationMessage } from "@/lib/utils/notification-message";
import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";
import { useNotificationTimeFormatter } from "@/lib/utils/notification-time";

import { CoworkerAccessNotificationActions } from "./coworker-access-notification-actions";
import { useCoworkerGrantResolution } from "./use-coworker-grant-resolution";

interface NotificationsPageContentProps {
  userId: string;
}

export function NotificationsPageContent({
  userId: _userId,
}: NotificationsPageContentProps) {
  const tCenter = useTranslations("Components.NotificationCenter");
  const tDetail = useTranslations("App.Tasks.Detail");
  const formatMessage = useNotificationMessage();
  const formatTime = useNotificationTimeFormatter();
  const { data: session } = useSession();
  const { handleSelectWorkspace } = useWorkspaceSwitcher();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const { notice } = useAccountNotice();
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
  const [hasFetchError, setHasFetchError] = useState(false);
  const fetchInFlightRef = useRef(false);
  const fetchGenerationRef = useRef(0);

  const fetchNotifications = useCallback(async (nextCursor?: string | null) => {
    if (fetchInFlightRef.current) {
      return;
    }

    fetchInFlightRef.current = true;
    const generation = ++fetchGenerationRef.current;
    const isInitialLoad = nextCursor == null;

    try {
      setIsLoading(true);
      const response = await coreClient.getNotifications({
        limit: 20,
        cursor: nextCursor ?? undefined,
      });

      if (generation !== fetchGenerationRef.current) {
        return;
      }

      setNotifications((prev) => {
        if (!nextCursor) {
          return response.data;
        }

        const existingIds = new Set(
          prev.map((notification) => notification.id),
        );
        const newItems = response.data.filter(
          (notification) => !existingIds.has(notification.id),
        );

        return [...prev, ...newItems];
      });
      const paginationMeta = response.meta.pagination;
      setHasMore(paginationMeta.nextCursor !== null);
      setCursor(paginationMeta.nextCursor);
      setHasFetchError(false);
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
      if (generation === fetchGenerationRef.current && isInitialLoad) {
        setHasFetchError(true);
      }
    } finally {
      if (generation === fetchGenerationRef.current) {
        setIsLoading(false);
        fetchInFlightRef.current = false;
      }
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

  const { grantsById, busyGrantId, resolveGrant } = useCoworkerGrantResolution({
    notifications,
    markRead,
    onMarkedRead: (notificationId) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n)),
      );
    },
  });

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

    await handleNotificationNavigation(
      notification,
      activeOrganizationId,
      router,
      handleSelectWorkspace,
      tDetail,
    );
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
      {notice !== null ? <AccountNoticeRow /> : null}
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
      ) : hasFetchError && notifications.length === 0 ? (
        <div className="bg-muted/30 border-border/50 flex flex-col items-center justify-center gap-3 rounded-xl border p-8">
          <p className="text-muted-foreground text-center">
            {tCenter("fetchError")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchNotifications()}
          >
            {tCenter("retry")}
          </Button>
        </div>
      ) : notifications.length === 0 && notice === null ? (
        <div className="bg-muted/30 border-border/50 flex flex-col items-center justify-center rounded-xl border p-8">
          <p className="text-muted-foreground text-center">
            {tCenter("emptyState")}
          </p>
        </div>
      ) : notifications.length > 0 ? (
        <>
          <div className="bg-muted/30 border-border/50 overflow-hidden rounded-xl border">
            <div className="divide-border/50 divide-y">
              {notifications.map((notification) => {
                const message = formatMessage(
                  notification.messageKey,
                  notification.messageParams ?? {},
                );

                if (notification.kind === "COWORKER_ACCESS") {
                  // Access requests resolve inline: approve/deny while the
                  // grant is pending, a status chip once decided. Clicking
                  // the message still deep-links to the portal.
                  return (
                    <div
                      key={notification.id}
                      className={cn(
                        "flex w-full flex-col gap-3 p-4",
                        !notification.isRead && "bg-accent/50",
                      )}
                    >
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-start gap-3 text-left"
                        onClick={() => handleNotificationClick(notification)}
                      >
                        <NotificationActorAvatar
                          notification={notification}
                          grant={grantsById?.[notification.referenceId] ?? null}
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
                      </button>
                      <CoworkerAccessNotificationActions
                        grant={grantsById?.[notification.referenceId] ?? null}
                        busy={busyGrantId === notification.referenceId}
                        onResolve={(status) =>
                          void resolveGrant(notification, status)
                        }
                      />
                    </div>
                  );
                }

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
                      <NotificationActorAvatar notification={notification} />
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
      ) : null}
    </div>
  );
}
