"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { useNotifications } from "@/contexts/notification-provider";
import { useNotificationRealtime } from "@/lib/ably/use-notification-realtime";
import { authClient } from "@/lib/auth/auth.client";
import { NOTIFICATION_TOASTER_ID } from "@/lib/constants/notification-toaster";
import {
  getBrowserNotificationPermission,
  shouldShowBrowserNotification,
  shouldShowInAppNotificationToast,
  showBrowserNotification,
} from "@/lib/utils/browser-notification";
import { useNotificationMessage } from "@/lib/utils/notification-message";
import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";

interface NotificationToastListenerProps {
  userId: string;
}

interface NotificationToastBodyProps {
  message: string;
  onOpen: () => void;
}

function NotificationToastBody({
  message,
  onOpen,
}: NotificationToastBodyProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hover:bg-accent/50 -my-1 flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md py-1 text-left transition-colors"
    >
      <span className="min-w-0 flex-1 text-sm font-medium leading-snug">
        {message}
      </span>
    </button>
  );
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
      const documentHidden =
        typeof document !== "undefined" ? document.hidden : false;
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

      if (
        shouldShowBrowserNotification({
          permission: getBrowserNotificationPermission(),
          documentHidden,
          isRead: notification.isRead,
        })
      ) {
        const browserNotification = showBrowserNotification({
          id: notification.id,
          title: t("browserNotificationTitle"),
          body: message,
          icon: "/images/app-icons/apple-icon-180.png",
          onClick: openNotification,
        });
        if (browserNotification == null) {
          console.error(
            "Browser notification gate passed but OS notification was not shown",
            { id: notification.id },
          );
        }
        return;
      }

      if (
        !shouldShowInAppNotificationToast({
          documentHidden,
          isRead: notification.isRead,
        })
      ) {
        return;
      }

      toast(
        () => (
          <NotificationToastBody
            message={message}
            onOpen={() => {
              toast.dismiss(notification.id);
              openNotification();
            }}
          />
        ),
        {
          id: notification.id,
          toasterId: NOTIFICATION_TOASTER_ID,
          duration: 10_000,
          dismissible: true,
          icon: <Bell className="text-primary size-5 shrink-0" />,
          action: {
            label: t("dismiss"),
            onClick: () => {
              toast.dismiss(notification.id);
            },
          },
        },
      );
    },
    onError: (error) => {
      console.error("Notification toast error:", error);
    },
  });

  return null;
}
