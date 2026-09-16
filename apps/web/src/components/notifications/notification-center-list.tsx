"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { NotificationsSkeletonRows } from "@/app/notifications/components/notifications-loading-view";
import { NotificationCenterRow } from "@/components/notifications/notification-center-row";
import { NotificationOlderBoundaryRow } from "@/components/notifications/notification-older-boundary-row";
import { Button } from "@/components/ui/button";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useNotifications } from "@/contexts/notification-provider";
import { useSession } from "@/lib/auth/auth.client";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { useNotificationMessage } from "@/lib/utils/notification-message";
import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";
import { useNotificationTimeFormatter } from "@/lib/utils/notification-time";

interface NotificationCenterListProps {
  /** Called as a row navigates away, so the header panel can close itself. */
  onNavigate?: () => void;
}

/**
 * The Notification Center's list, drawn once for both of its frames.
 *
 * The header panel and the notifications page render this over the same
 * provider state, so the two cannot disagree about which rows exist, what
 * order they are in, or which of them are read. Each frame adds its own
 * chrome around it — a title and a footer in the panel, a card and a page
 * header on the page — and nothing else.
 *
 * Older rows arrive as the reader scrolls: the boundary row at the end asks
 * for the next page as soon as it comes into view, and keeps asking until
 * Core has nothing older left.
 */
export function NotificationCenterList({
  onNavigate,
}: NotificationCenterListProps) {
  const t = useTranslations("Components.NotificationCenter");
  const tDetail = useTranslations("App.Tasks.Detail");
  const router = useRouter();
  const formatMessage = useNotificationMessage();
  const formatTime = useNotificationTimeFormatter();
  const { data: session } = useSession();
  const { handleSelectWorkspace } = useWorkspaceSwitcher();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const { notice } = useAccountNotice();
  const {
    notifications,
    markRead,
    isLoading,
    hasFetchError,
    refetch,
    hasMore,
    olderStatus,
    loadOlder,
  } = useNotifications();
  const [pendingNotificationId, setPendingNotificationId] = useState<
    string | null
  >(null);

  const handleNotificationClick = (notification: NotificationItem) => {
    // Immediate paint: pending state + optimistic read. Network and navigation
    // stay off the interaction's critical path for INP.
    setPendingNotificationId(notification.id);
    onNavigate?.();

    if (!notification.isRead) {
      // Navigation goes ahead either way: the reader asked to open the row.
      void markRead(notification.id).catch(() => {
        toast.error(t("markReadError"));
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

  if (notifications.length === 0) {
    if (isLoading) {
      return <NotificationsSkeletonRows />;
    }

    if (hasFetchError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-8">
          <p className="text-muted-foreground text-center text-sm">
            {t("fetchError")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      );
    }

    // An account notice above the list already gives the frame something to
    // say, and "No notifications yet" under it would read as a contradiction.
    if (notice !== null) {
      return null;
    }

    return (
      <div className="flex flex-col items-center justify-center p-8">
        <p className="text-muted-foreground text-center text-sm">
          {t("emptyState")}
        </p>
      </div>
    );
  }

  const oldest = notifications.at(-1);

  return (
    <>
      <div className="divide-border divide-y">
        {notifications.map((notification) => (
          <NotificationCenterRow
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
      {/* Nothing older left means nothing here: the end of the list reads as
          the end, rather than as a list that stopped for a reason. */}
      {hasMore && oldest ? (
        <NotificationOlderBoundaryRow
          oldestId={oldest.id}
          status={olderStatus}
          onLoad={loadOlder}
        />
      ) : null}
    </>
  );
}
