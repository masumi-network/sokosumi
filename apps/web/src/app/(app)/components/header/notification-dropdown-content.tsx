"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useNotifications } from "@/contexts/notification-provider";
import { getNotificationHref } from "@/lib/utils/notification-href";
import { useNotificationTimeFormatter } from "@/lib/utils/notification-time";

import { NotificationItem } from "./notification-item";

interface NotificationDropdownContentProps {
  onClose: () => void;
}

export function NotificationDropdownContent({
  onClose,
}: NotificationDropdownContentProps) {
  const t = useTranslations("Components.NotificationCenter");
  const router = useRouter();
  const formatTime = useNotificationTimeFormatter();
  const { notifications, markRead, isLoading, hasFetchError, refetch } =
    useNotifications();

  const handleNotificationClick = async (notificationId: string) => {
    const notification = notifications.find((n) => n.id === notificationId);
    if (!notification) return;

    if (!notification.isRead) {
      try {
        await markRead(notificationId);
      } catch {
        return;
      }
    }

    const href = getNotificationHref({
      kind: notification.kind,
      referenceId: notification.referenceId,
      metadata: notification.metadata,
    });

    router.push(href);
    onClose();
  };

  const handleSeeMoreClick = () => {
    router.push("/notifications");
    onClose();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="bg-muted size-12 animate-pulse rounded-full" />
        <div className="bg-muted mt-4 h-4 w-32 animate-pulse rounded" />
      </div>
    );
  }

  if (hasFetchError && notifications.length === 0) {
    return (
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
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <p className="text-muted-foreground text-sm">{t("emptyState")}</p>
      </div>
    );
  }

  return (
    <>
      <DropdownMenuLabel>{t("title")}</DropdownMenuLabel>
      <DropdownMenuSeparator />
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
