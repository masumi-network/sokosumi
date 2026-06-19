"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useNotifications } from "@/contexts/notification-provider";
import { useNotificationRealtime } from "@/lib/ably/use-notification-realtime";
import { NOTIFICATION_TOASTER_ID } from "@/lib/constants/notification-toaster";
import { getNotificationHref } from "@/lib/utils/notification-href";
import { useNotificationMessage } from "@/lib/utils/notification-message";

interface NotificationToastListenerProps {
  userId: string;
}

export function NotificationToastListener({
  userId,
}: NotificationToastListenerProps) {
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

        toast.custom(
          (toastId) => (
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  if (!notification.isRead) {
                    try {
                      await markRead(notification.id);
                    } catch {
                      return;
                    }
                  }

                  router.push(href);
                  toast.dismiss(toastId);
                })();
              }}
              className="bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground border-border flex w-full cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 shadow-lg transition-colors"
            >
              <Bell className="text-muted-foreground size-5 shrink-0" />
              <p className="min-w-0 flex-1 text-left text-sm font-medium leading-snug">
                {message}
              </p>
              <span className="bg-green-500 size-2 shrink-0 rounded-full" />
            </button>
          ),
          {
            id: notification.id,
            toasterId: NOTIFICATION_TOASTER_ID,
            duration: Infinity,
            dismissible: true,
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
