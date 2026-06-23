"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useNotifications } from "@/contexts/notification-provider";
import { useNotificationRealtime } from "@/lib/ably/use-notification-realtime";
import { NOTIFICATION_TOASTER_ID } from "@/lib/constants/notification-toaster";
import { getNotificationHref } from "@/lib/utils/notification-href";
import { useNotificationMessage } from "@/lib/utils/notification-message";

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
  const formatMessage = useNotificationMessage();
  const { markRead } = useNotifications();
  const router = useRouter();

  useNotificationRealtime({
    userId,
    onNotification: (notification) => {
      if (!notification.isRead) {
        const message = formatMessage(
          notification.messageKey,
          notification.messageParams ?? {},
        );

        const href = getNotificationHref({
          kind: notification.kind,
          referenceId: notification.referenceId,
          metadata: notification.metadata,
        });

        toast(
          () => (
            <NotificationToastBody
              message={message}
              onOpen={() => {
                void (async () => {
                  if (!notification.isRead) {
                    try {
                      await markRead(notification.id);
                    } catch {
                      // Still open the link when mark-read fails.
                    }
                  }

                  router.push(href);
                  toast.dismiss(notification.id);
                })();
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
      }
    },
    onError: (error) => {
      console.error("Notification toast error:", error);
    },
  });

  return null;
}
