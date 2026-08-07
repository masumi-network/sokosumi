"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AccountNoticeRow } from "@/app/components/account-notice-row";
import { NotificationBrowserPermissionPrimer } from "@/app/components/notification-browser-permission-primer";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { NotificationsListSkeleton } from "@/app/notifications/components/notifications-loading-view";
import { CoworkerAccessNotificationActions } from "@/components/notifications/coworker-access-notification-actions";
import { VendorGrantNotificationActions } from "@/components/notifications/vendor-grant-notification-actions";
import { Button } from "@/components/ui/button";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useNotifications } from "@/contexts/notification-provider";
import { useSession } from "@/lib/auth/auth.client";
import { notificationsBrowserClient } from "@/lib/clients/core.notifications.browser.client";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { isPendingCoworkerAccessNotification } from "@/lib/utils/coworker-access-notification";
import { useNotificationMessage } from "@/lib/utils/notification-message";
import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";
import { useNotificationTimeFormatter } from "@/lib/utils/notification-time";
import { isPendingVendorGrantNotification } from "@/lib/utils/vendor-grant-notification";

interface NotificationsPageContentProps {
  userId: string;
}

function markNotificationReadLocally(
  notifications: NotificationItem[],
  notificationId: string,
): NotificationItem[] {
  let changed = false;
  const readAt = new Date();
  const next = notifications.map((notification) => {
    if (notification.id !== notificationId || notification.isRead) {
      return notification;
    }

    changed = true;
    return { ...notification, isRead: true, readAt };
  });

  return changed ? next : notifications;
}

function markAllNotificationsReadLocally(
  notifications: NotificationItem[],
): NotificationItem[] {
  let changed = false;
  const readAt = new Date();
  const next = notifications.map((notification) => {
    if (notification.isRead) {
      return notification;
    }

    changed = true;
    return { ...notification, isRead: true, readAt };
  });

  return changed ? next : notifications;
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
  const [pendingNotificationId, setPendingNotificationId] = useState<
    string | null
  >(null);
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
      const response = await notificationsBrowserClient.getNotifications({
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

  const handleNotificationClick = (notification: NotificationItem) => {
    // Immediate paint: pending state + optimistic read. Network/navigation
    // stay off the interaction's critical path for INP.
    setPendingNotificationId(notification.id);

    if (!notification.isRead) {
      setNotifications((prev) =>
        markNotificationReadLocally(prev, notification.id),
      );
      void markRead(notification.id).catch((error) => {
        console.error("Failed to mark notification as read:", error);
      });
    }

    void handleNotificationNavigation(
      notification,
      activeOrganizationId,
      router,
      handleSelectWorkspace,
      tDetail,
    ).finally(() => {
      setPendingNotificationId((current) =>
        current === notification.id ? null : current,
      );
    });
  };

  const handleMarkAllRead = () => {
    if (isMarkingAllRead) return;

    setIsMarkingAllRead(true);
    setNotifications(markAllNotificationsReadLocally);

    void markAllRead()
      .catch(() => {
        toast.error(tCenter("markAllReadError"));
        void fetchNotifications();
      })
      .finally(() => {
        setIsMarkingAllRead(false);
      });
  };

  const handleLoadMore = () => {
    void fetchNotifications(cursor);
  };

  return (
    <div className="flex flex-col gap-5 pb-4">
      {notice !== null ? <AccountNoticeRow /> : null}
      <NotificationBrowserPermissionPrimer variant="page" />
      {unreadCount > 0 ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            className="self-start"
            onClick={handleMarkAllRead}
            disabled={isMarkingAllRead}
          >
            {isMarkingAllRead ? tCenter("loading") : tCenter("markAllRead")}
          </Button>
        </div>
      ) : null}

      {isLoading && notifications.length === 0 ? (
        <NotificationsListSkeleton />
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
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  isPending={pendingNotificationId === notification.id}
                  message={formatMessage(
                    notification.messageKey,
                    notification.messageParams ?? {},
                  )}
                  timeLabel={formatTime(notification.createdAt)}
                  onClick={handleNotificationClick}
                />
              ))}
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

interface NotificationRowProps {
  notification: NotificationItem;
  isPending: boolean;
  message: string;
  timeLabel: string;
  onClick: (notification: NotificationItem) => void;
}

function NotificationRow({
  notification,
  isPending,
  message,
  timeLabel,
  onClick,
}: NotificationRowProps) {
  const showVendorGrantActions = isPendingVendorGrantNotification(notification);
  const showCoworkerAccessActions =
    isPendingCoworkerAccessNotification(notification);
  const showPendingAccessActions =
    showVendorGrantActions || showCoworkerAccessActions;
  const rowClassName = cn(
    "hover:bg-accent flex w-full p-4 text-left transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_72px]",
    !notification.isRead && "bg-accent/50",
    isPending && "bg-accent opacity-80",
    showPendingAccessActions ? "cursor-default" : "cursor-pointer",
  );

  const body = (
    <div className="flex w-full items-start gap-3">
      <Bell
        className={cn(
          "mt-0.5 size-4 shrink-0",
          notification.isRead ? "text-muted-foreground" : "text-primary",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {showPendingAccessActions ? (
          <button
            type="button"
            className="hover:bg-accent/50 -mx-1 cursor-pointer rounded-md px-1 text-left"
            onClick={() => onClick(notification)}
          >
            <p className={cn("text-sm", !notification.isRead && "font-medium")}>
              {message}
            </p>
            <p className="text-muted-foreground text-xs">{timeLabel}</p>
          </button>
        ) : (
          <>
            <p className={cn("text-sm", !notification.isRead && "font-medium")}>
              {message}
            </p>
            <p className="text-muted-foreground text-xs">{timeLabel}</p>
          </>
        )}
        {showVendorGrantActions ? (
          <VendorGrantNotificationActions
            notification={notification}
            layout="inline"
          />
        ) : null}
        {showCoworkerAccessActions ? (
          <CoworkerAccessNotificationActions
            notification={notification}
            layout="inline"
          />
        ) : null}
      </div>
    </div>
  );

  if (showPendingAccessActions) {
    return <div className={rowClassName}>{body}</div>;
  }

  return (
    <button
      type="button"
      className={rowClassName}
      onClick={() => onClick(notification)}
    >
      {body}
    </button>
  );
}
