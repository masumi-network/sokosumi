"use client";

import { MailOpen } from "lucide-react";
import { useTranslations } from "next-intl";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useNotifications } from "@/contexts/notification-provider";

interface MarkNotificationUnreadMenuItemProps {
  notificationId: string;
  /** The row's own message, so a column of controls says what each acts on. */
  notificationMessage: string;
}

/**
 * The control that puts one notification back to unread, in the bell dropdown.
 *
 * The way out of a read the reader did not mean, including the read the
 * notification center writes for them when they close it. A menu item of its
 * own rather than a button inside the row's item, for the same reason the
 * delete control is one: arrow keys reach it, and each element in the menu
 * keeps one role.
 */
export function MarkNotificationUnreadMenuItem({
  notificationId,
  notificationMessage,
}: MarkNotificationUnreadMenuItemProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { markUnread } = useNotifications();

  return (
    <DropdownMenuItem
      aria-label={t("markUnread", { message: notificationMessage })}
      className="text-muted-foreground focus:bg-foreground/10 focus:text-foreground my-2 size-7 shrink-0 justify-center p-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-has-[[data-highlighted]]/row:opacity-100"
      onSelect={(event) => {
        // The menu stays open: the reader is putting a row back to come
        // back to, so closing the panel on them would undo the point.
        event.preventDefault();
        markUnread(notificationId).catch(() => {
          // The provider logged it and refetched. The row stays read, which
          // is the visible, recoverable way to be wrong.
        });
      }}
    >
      <MailOpen className="size-4" />
    </DropdownMenuItem>
  );
}
