"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { useNotifications } from "@/contexts/notification-provider";
import { useNotificationRealtime } from "@/lib/ably/use-notification-realtime";
import { authClient } from "@/lib/auth/auth.client";
import {
  getBrowserNotificationPermission,
  shouldShowBrowserNotification,
  showBrowserNotification,
} from "@/lib/utils/browser-notification";
import { useNotificationMessage } from "@/lib/utils/notification-message";
import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";

interface NotificationToastListenerProps {
  userId: string;
}

export function NotificationToastListener({
  userId,
}: NotificationToastListenerProps) {
  const t = useTranslations("Components.NotificationCenter");
  const tDetail = useTranslations("App.Tasks.Detail");
  const formatMessage = useNotificationMessage();
  const { markRead } = useNotifications();
  const router = useRouter();
  const { handleSelectWorkspace } = useWorkspaceSwitcher();

  useNotificationRealtime({
    userId,
    onNotification: (notification) => {
      const isDocumentFocused =
        typeof document !== "undefined" ? document.hasFocus() : true;
      const permission = getBrowserNotificationPermission();
      const showBrowser = shouldShowBrowserNotification({
        permission,
        isDocumentFocused,
        isRead: notification.isRead,
      });

      if (!showBrowser) {
        return;
      }

      const message = formatMessage(
        notification.messageKey,
        notification.messageParams ?? {},
      );

      const openNotification = () => {
        void (async () => {
          if (!notification.isRead) {
            void markRead(notification.id).catch(() => {
              // Still open the link when mark-read fails.
            });
          }

          const sessionResponse = await authClient.getSession();
          const activeOrganizationId =
            sessionResponse.data?.session.activeOrganizationId ?? null;

          await handleNotificationNavigation(
            notification,
            activeOrganizationId,
            router,
            handleSelectWorkspace,
            tDetail,
          );
        })();
      };

      const browserNotification = showBrowserNotification({
        id: notification.id,
        title: t("browserNotificationTitle"),
        body: message,
        icon: new URL(
          "/images/app-icons/apple-icon-180.png",
          window.location.origin,
        ).href,
        onClick: openNotification,
      });
      if (browserNotification == null) {
        console.error(
          "Browser notification gate passed but OS notification was not shown",
          { id: notification.id },
        );
      }
    },
    onError: (error) => {
      console.error("Notification browser alert error:", error);
    },
  });

  return null;
}
