"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MouseEvent } from "react";

import { useDeleteNotification } from "@/components/notifications/use-delete-notification";
import { Button } from "@/components/ui/button";

interface DeleteNotificationButtonProps {
  notificationId: string;
  /** The row's own message, so a column of controls says what each removes. */
  notificationMessage: string;
}

/** The control that removes one notification for good, on the page. */
export function DeleteNotificationButton({
  notificationId,
  notificationMessage,
}: DeleteNotificationButtonProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { requestDelete } = useDeleteNotification(notificationId);

  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    // The row underneath opens the notification. Deleting is not opening.
    event.stopPropagation();
    event.preventDefault();
    void requestDelete();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t("delete", { message: notificationMessage })}
      className="text-muted-foreground size-7 shrink-0"
      onClick={handleClick}
    >
      <X className="size-4" />
    </Button>
  );
}
