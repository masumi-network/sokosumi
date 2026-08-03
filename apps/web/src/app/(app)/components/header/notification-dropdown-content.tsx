"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { AccountNoticeRow } from "@/app/components/account-notice-row";
import { NotificationBrowserPermissionPrimer } from "@/app/components/notification-browser-permission-primer";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useNotifications } from "@/contexts/notification-provider";
import { useSession } from "@/lib/auth/auth.client";
import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";
import { useNotificationTimeFormatter } from "@/lib/utils/notification-time";
import { NotificationItem } from "./notification-item";

interface NotificationDropdownContentProps {
  onClose: () => void;
}

export function NotificationDropdownContent({
  onClose,
}: NotificationDropdownContentProps) {
  const t = useTranslations("Components.NotificationCenter");
  const tDetail = useTranslations("App.Tasks.Detail");
  const router = useRouter();
  const formatTime = useNotificationTimeFormatter();
  const { data: session } = useSession();
  const { handleSelectWorkspace } = useWorkspaceSwitcher();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const { notice } = useAccountNotice();
  const {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    isLoading,
    hasFetchError,
    refetch,
  } = useNotifications();
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);

  const handleNotificationClick = (notificationId: string) => {
    const notification = notifications.find((n) => n.id === notificationId);
    if (!notification) return;

    // Close immediately so the click paints before navigation work.
    onClose();

    // Optimistic mark-read paints via the provider before navigation work.
    if (!notification.isRead) {
      void markRead(notificationId).catch(() => {
        // Still navigate when mark-read fails transiently.
      });
    }

    void handleNotificationNavigation(
      notification,
      activeOrganizationId,
      router,
      handleSelectWorkspace,
      tDetail,
    );
  };

  const handleMarkAllRead = () => {
    if (isMarkingAllRead || unreadCount === 0) return;

    setIsMarkingAllRead(true);
    void markAllRead()
      .catch(() => {
        toast.error(t("markAllReadError"));
      })
      .finally(() => {
        setIsMarkingAllRead(false);
      });
  };

  const handleSeeMoreClick = () => {
    router.push("/notifications");
    onClose();
  };

  const accountNoticeSection =
    notice !== null ? (
      <>
        <AccountNoticeRow variant="menu" onActionComplete={onClose} />
        <DropdownMenuSeparator />
      </>
    ) : null;

  if (isLoading && notifications.length === 0) {
    return (
      <>
        {accountNoticeSection}
        <NotificationBrowserPermissionPrimer className="mx-2 mt-2" />
        <div className="flex flex-col items-center justify-center py-8">
          <div className="bg-muted size-12 animate-pulse rounded-full" />
          <div className="bg-muted mt-4 h-4 w-32 animate-pulse rounded" />
        </div>
      </>
    );
  }

  if (hasFetchError && notifications.length === 0) {
    return (
      <>
        {accountNoticeSection}
        <NotificationBrowserPermissionPrimer className="mx-2 mt-2" />
        <div className="flex flex-col items-center gap-3 px-4 py-8">
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
      </>
    );
  }

  if (notifications.length === 0) {
    return (
      <>
        {accountNoticeSection}
        <NotificationBrowserPermissionPrimer className="mx-2 mt-2" />
        {notice === null ? (
          <div className="flex flex-col items-center justify-center py-8">
            <p className="text-muted-foreground text-sm">{t("emptyState")}</p>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      {accountNoticeSection}
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <DropdownMenuLabel className="p-0">{t("title")}</DropdownMenuLabel>
        {unreadCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-auto px-2 py-1 text-xs font-normal"
            onPointerDown={(event) => {
              event.preventDefault();
            }}
            onClick={handleMarkAllRead}
            disabled={isMarkingAllRead}
          >
            {isMarkingAllRead ? t("loading") : t("markAllRead")}
          </Button>
        ) : null}
      </div>
      <DropdownMenuSeparator />
      <NotificationBrowserPermissionPrimer className="mx-2 my-2" />
      <div className="max-h-96 overflow-y-auto">
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onClick={() => handleNotificationClick(notification.id)}
            formatTime={formatTime}
          />
        ))}
      </div>
      <DropdownMenuSeparator />
      <div className="p-2">
        <Button
          variant="ghost"
          className="w-full"
          size="sm"
          onClick={handleSeeMoreClick}
        >
          {t("seeMore")}
        </Button>
      </div>
    </>
  );
}
