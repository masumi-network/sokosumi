"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";
import { useNotificationRealtime } from "@/lib/ably/use-notification-realtime";
import { getNotificationHref } from "@/lib/utils/notification-href";

interface NotificationToastListenerProps {
  userId: string;
}

export function NotificationToastListener({
  userId,
}: NotificationToastListenerProps) {
  const t = useTranslations("Notifications");
  const router = useRouter();

  useNotificationRealtime({
    userId,
    onNotification: (notification) => {
      if (!notification.isRead) {
        const messageKey = notification.messageKey;
        const messageParams = notification.messageParams ?? {};

        let message: string;
        try {
          message = t(messageKey as never, messageParams as never);
        } catch {
          message = messageKey;
        }

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
                router.push(href);
                toast.dismiss(toastId);
              }}
              className="bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground border-border flex w-full cursor-pointer items-start gap-3 rounded-lg border p-4 shadow-lg transition-colors"
            >
              <Bell className="text-muted-foreground mt-0.5 size-5 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-sm font-medium leading-snug">{message}</p>
              </div>
              <span className="bg-green-500 mt-1.5 size-2 shrink-0 rounded-full" />
            </button>
          ),
          {
            duration: 5000,
            position: "top-right",
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
