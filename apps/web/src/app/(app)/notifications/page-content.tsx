"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AccountNoticeRow } from "@/app/components/account-notice-row";
import { NotificationBrowserPermissionPrimer } from "@/app/components/notification-browser-permission-primer";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { NotificationsListSkeleton } from "@/app/notifications/components/notifications-loading-view";
import { ClearNotificationsDialog } from "@/components/notifications/clear-notifications-dialog";
import { CoworkerAccessNotificationActions } from "@/components/notifications/coworker-access-notification-actions";
import { DeleteNotificationButton } from "@/components/notifications/delete-notification-button";
import { VendorGrantNotificationActions } from "@/components/notifications/vendor-grant-notification-actions";
import { Button } from "@/components/ui/button";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useNotifications } from "@/contexts/notification-provider";
import { useSession } from "@/lib/auth/auth.client";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { isPendingCoworkerAccessNotification } from "@/lib/utils/coworker-access-notification";
import { getNotificationIcon } from "@/lib/utils/notification-icon";
import { useNotificationMessage } from "@/lib/utils/notification-message";
import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";
import { useNotificationTimeFormatter } from "@/lib/utils/notification-time";
import { isPendingVendorGrantNotification } from "@/lib/utils/vendor-grant-notification";

import {
  removeNotificationLocally,
  useNotificationsPage,
} from "./use-notifications-page";

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
  const { markRead, markAllRead, unreadCount } = useNotifications();
  const router = useRouter();
  const {
    notifications,
    setNotifications,
    isLoading,
    hasMore,
    cursor,
    hasFetchError,
    isMutating,
    fetchNotifications,
  } = useNotificationsPage();
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [pendingNotificationId, setPendingNotificationId] = useState<
    string | null
  >(null);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

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
    <div ref={pageRef} tabIndex={-1} className="flex flex-col gap-5 pb-4">
      {notice !== null ? <AccountNoticeRow /> : null}
      <NotificationBrowserPermissionPrimer variant="page" />
      {unreadCount > 0 || notifications.length > 0 ? (
        <div className="flex justify-end gap-2">
          {notifications.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              ref={clearButtonRef}
              onClick={() => setIsClearDialogOpen(true)}
            >
              {tCenter("clearAll")}
            </Button>
          ) : null}
          {unreadCount > 0 ? (
            <Button
              type="button"
              size="sm"
              className="self-start"
              onClick={handleMarkAllRead}
              disabled={isMarkingAllRead}
            >
              {isMarkingAllRead ? tCenter("loading") : tCenter("markAllRead")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {isLoading && notifications.length === 0 ? (
        <NotificationsListSkeleton />
      ) : hasFetchError && notifications.length === 0 ? (
        <div className="bg-card-background border-border flex flex-col items-center justify-center gap-3 rounded-xl border p-8">
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
        <div className="bg-card-background border-border flex flex-col items-center justify-center rounded-xl border p-8">
          <p className="text-muted-foreground text-center">
            {tCenter("emptyState")}
          </p>
        </div>
      ) : notifications.length > 0 ? (
        <>
          <div className="bg-card-background border-border overflow-hidden rounded-xl border">
            <div className="divide-border divide-y">
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
                  onAccessRequestAccepted={(notificationId) => {
                    setNotifications((prev) =>
                      removeNotificationLocally(prev, notificationId),
                    );
                  }}
                />
              ))}
            </div>
          </div>
          {hasMore ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                disabled={isLoading || isMutating}
              >
                {isLoading ? tCenter("loading") : tCenter("loadMore")}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      <ClearNotificationsDialog
        open={isClearDialogOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (clearButtonRef.current ?? pageRef.current)?.focus();
        }}
        onOpenChange={setIsClearDialogOpen}
      />
    </div>
  );
}

interface NotificationRowProps {
  notification: NotificationItem;
  isPending: boolean;
  message: string;
  timeLabel: string;
  onClick: (notification: NotificationItem) => void;
  onAccessRequestAccepted: (notificationId: string) => void;
}

function NotificationRow({
  notification,
  isPending,
  message,
  timeLabel,
  onClick,
  onAccessRequestAccepted,
}: NotificationRowProps) {
  const showVendorGrantActions = isPendingVendorGrantNotification(notification);
  const showCoworkerAccessActions =
    isPendingCoworkerAccessNotification(notification);
  const showPendingAccessActions =
    showVendorGrantActions || showCoworkerAccessActions;
  const Icon = getNotificationIcon(notification);
  const rowClassName = cn(
    "group/row hover:bg-accent flex w-full items-start text-left transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_72px]",
    isPending && "bg-accent opacity-80",
    showPendingAccessActions ? "cursor-default" : "cursor-pointer",
  );

  const body = (
    <div className="flex w-full items-start gap-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          // Opaque, so the disc no longer tracks the row's hover tint the way
          // the old alpha did: on a hovered row it measures 1.16:1 light and
          // 1.28:1 dark against --card-background, so its edge reads as faint.
          // The glyph inside is what carries the state, and it keeps 4.07:1
          // light and 3.52:1 dark on --quinary. The next step up, --quaternary,
          // would sharpen the disc and drop that glyph to 2.28:1 in dark, under
          // the 3:1 floor, which is the worse trade.
          notification.isRead
            ? "bg-quinary text-muted-foreground"
            : "bg-primary-quaternary text-primary",
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {showPendingAccessActions ? (
          <button
            type="button"
            className="hover:bg-card-background -mx-1 cursor-pointer rounded-md px-1 text-left"
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
            onAccepted={() => {
              onAccessRequestAccepted(notification.id);
            }}
          />
        ) : null}
        {showCoworkerAccessActions ? (
          <CoworkerAccessNotificationActions
            notification={notification}
            layout="inline"
            onAccepted={() => {
              onAccessRequestAccepted(notification.id);
            }}
          />
        ) : null}
      </div>
    </div>
  );

  // The delete control sits beside the row rather than inside it, because the
  // row itself is the button that opens the notification.
  const deleteControl = (
    <DeleteNotificationButton
      notificationId={notification.id}
      isRead={notification.isRead}
      notificationMessage={message}
    />
  );

  if (showPendingAccessActions) {
    return (
      <div className={rowClassName}>
        <div className="flex min-w-0 flex-1 p-4">{body}</div>
        <div className="p-3">{deleteControl}</div>
      </div>
    );
  }

  // The padding lives on the button, so the whole row stays one click target.
  return (
    <div className={rowClassName}>
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer p-4 text-left"
        onClick={() => onClick(notification)}
      >
        {body}
      </button>
      <div className="p-3">{deleteControl}</div>
    </div>
  );
}
