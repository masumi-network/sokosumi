"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { CoworkerAccessNotificationActions } from "@/components/notifications/coworker-access-notification-actions";
import { VendorGrantNotificationActions } from "@/components/notifications/vendor-grant-notification-actions";
import type { NotificationEventData } from "@/lib/ably/schema";
import { useNotificationRealtime } from "@/lib/ably/use-notification-realtime";
import { authClient } from "@/lib/auth/auth.client";
import { NOTIFICATION_TOASTER_ID } from "@/lib/constants/notification-toaster";
import {
  getBrowserNotificationPermission,
  shouldShowBrowserNotification,
  showBrowserNotification,
} from "@/lib/utils/browser-notification";
import { isPendingCoworkerAccessNotification } from "@/lib/utils/coworker-access-notification";
import { useNotificationMessage } from "@/lib/utils/notification-message";
import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";
import { isPendingVendorGrantNotification } from "@/lib/utils/vendor-grant-notification";

interface NotificationToastListenerProps {
  userId: string;
  markRead: (id: string) => Promise<void>;
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

interface PendingAccessNotificationToastProps {
  notification: NotificationEventData;
  message: string;
  onOpen: () => void;
}

function PendingAccessNotificationToast({
  notification,
  message,
  onOpen,
}: PendingAccessNotificationToastProps) {
  const showVendorGrantActions = isPendingVendorGrantNotification(notification);
  const showCoworkerAccessActions =
    isPendingCoworkerAccessNotification(notification);

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <NotificationToastBody
        message={message}
        onOpen={() => {
          toast.dismiss(notification.id);
          onOpen();
        }}
      />
      {showVendorGrantActions ? (
        <VendorGrantNotificationActions
          notification={notification}
          layout="toast"
          onAccepted={() => {
            toast.dismiss(notification.id);
          }}
        />
      ) : null}
      {showCoworkerAccessActions ? (
        <CoworkerAccessNotificationActions
          notification={notification}
          layout="toast"
          onAccepted={() => {
            toast.dismiss(notification.id);
          }}
        />
      ) : null}
    </div>
  );
}

export function NotificationToastListener({
  userId,
  markRead,
}: NotificationToastListenerProps) {
  const t = useTranslations("Components.NotificationCenter");
  const tDetail = useTranslations("App.Tasks.Detail");
  const formatMessage = useNotificationMessage();
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
      const showPendingAccessToast =
        isDocumentFocused &&
        !notification.isRead &&
        (isPendingVendorGrantNotification(notification) ||
          isPendingCoworkerAccessNotification(notification));

      if (!showBrowser && !showPendingAccessToast) {
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

      if (showBrowser) {
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
        return;
      }

      toast(
        () => (
          <PendingAccessNotificationToast
            notification={notification}
            message={message}
            onOpen={openNotification}
          />
        ),
        {
          id: notification.id,
          toasterId: NOTIFICATION_TOASTER_ID,
          duration: 10_000,
          dismissible: true,
          icon: <Bell className="text-primary size-5 shrink-0" />,
        },
      );
    },
    onError: (error) => {
      console.error("Notification browser alert error:", error);
    },
  });

  return null;
}
