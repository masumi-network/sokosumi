"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffectEvent } from "react";
import { toast } from "sonner";

import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { CoworkerAccessNotificationActions } from "@/components/notifications/coworker-access-notification-actions";
import { VendorGrantNotificationActions } from "@/components/notifications/vendor-grant-notification-actions";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { NotificationEventData } from "@/lib/ably/schema";
import { useNotificationRealtime } from "@/lib/ably/use-notification-realtime";
import { authClient } from "@/lib/auth/auth.client";
import { NOTIFICATION_TOASTER_ID } from "@/lib/constants/notification-toaster";
import {
  getBrowserNotificationPermission,
  shouldShowBrowserNotification,
} from "@/lib/utils/browser-notification";
import { isPendingCoworkerAccessNotification } from "@/lib/utils/coworker-access-notification";
import { useNotificationMessage } from "@/lib/utils/notification-message";
import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";
import type { NotificationTarget } from "@/lib/utils/notification-service-worker";
import {
  answerShowsNotificationsQuery,
  getNotificationServiceWorker,
  showNotification,
  subscribeNotificationClicks,
  toNotificationTarget,
} from "@/lib/utils/notification-service-worker";
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

  function openNotification(target: NotificationTarget, isRead: boolean) {
    void (async () => {
      if (!isRead) {
        void markRead(target.id).catch(() => {
          // Still open the link when mark-read fails.
        });
      }

      const sessionResponse = await authClient.getSession();
      const activeOrganizationId =
        sessionResponse.data?.session.activeOrganizationId ?? null;

      await handleNotificationNavigation(
        target,
        activeOrganizationId,
        router,
        handleSelectWorkspace,
        tDetail,
      );
    })();
  }

  /**
   * `handleSelectWorkspace` is a new function on every render, so subscribing
   * on each change would tear the worker's message listener down and back up
   * constantly, and a click landing in that gap would be lost. This keeps one
   * stable identity that always runs the current render's callback.
   */
  const openClickedNotification = useEffectEvent(
    (target: NotificationTarget) => {
      // A banner the reader clicks was unread when it was rendered.
      openNotification(target, false);
    },
  );

  const { isReceivingNotifications } = useNotificationRealtime({
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

      if (showBrowser) {
        // The worker is the only thing that renders an OS banner (ADR-0018),
        // so a push carrying this same notification replaces this banner by
        // tag rather than stacking a second one beside it.
        void showNotification({
          title: t("browserNotificationTitle"),
          body: message,
          target: toNotificationTarget(notification),
        }).then((shown) => {
          if (!shown) {
            console.error(
              "Browser notification gate passed but OS notification was not shown",
              { id: notification.id },
            );
          }
        });
        return;
      }

      toast(
        () => (
          <PendingAccessNotificationToast
            notification={notification}
            message={message}
            onOpen={() =>
              openNotification(
                toNotificationTarget(notification),
                notification.isRead,
              )
            }
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

  /**
   * The worker asks before it skips a banner. Answering yes while the channel
   * is detached would drop the notification twice over: no banner from the
   * worker, and no in-app update either.
   */
  const showsNotifications = useEffectEvent(() => isReceivingNotifications());

  // Install the worker ahead of the first banner. A reader who never turns
  // push on still renders through it, so waiting for an install at banner time
  // would cost them the banner's timing.
  useMountEffect(() => {
    if (getBrowserNotificationPermission() === "granted") {
      void getNotificationServiceWorker();
    }

    const unsubscribeClicks = subscribeNotificationClicks((target) => {
      openClickedNotification(target);
    });
    const stopAnswering = answerShowsNotificationsQuery(() =>
      showsNotifications(),
    );

    return () => {
      unsubscribeClicks();
      stopAnswering();
    };
  });

  return null;
}
