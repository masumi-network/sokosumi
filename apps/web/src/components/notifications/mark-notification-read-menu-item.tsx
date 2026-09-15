"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useNotifications } from "@/contexts/notification-provider";

interface MarkNotificationReadMenuItemProps {
  notificationId: string;
  /** The row's own message, so a column of controls says what each acts on. */
  notificationMessage: string;
}

/**
 * The control that marks one notification read, in the bell dropdown.
 *
 * Reading a notification and acting on it are different things. Opening a row
 * navigates away from the panel, so clearing a row the reader has finished
 * with used to mean either leaving the bell or clearing every row at once.
 * This does the one row and nothing else.
 *
 * A menu item of its own rather than a button inside the row's item, for the
 * same reason the delete control is one: arrow keys reach it, and each element
 * in the menu keeps one role.
 */
export function MarkNotificationReadMenuItem({
  notificationId,
  notificationMessage,
}: MarkNotificationReadMenuItemProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { markRead } = useNotifications();

  return (
    <DropdownMenuItem
      aria-label={t("markRead", { message: notificationMessage })}
      className="text-muted-foreground focus:bg-foreground/10 focus:text-foreground my-2 size-7 shrink-0 justify-center p-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-has-[[data-highlighted]]/row:opacity-100"
      onSelect={(event) => {
        // The menu stays open: clearing one row is not a reason to take the
        // rest of the list away, and the reader may want to clear several.
        event.preventDefault();
        markRead(notificationId).catch(() => {
          // The provider logged it and refetched. The row stays unread, which
          // is the visible, recoverable way to be wrong.
        });
      }}
    >
      <Check className="size-4" />
    </DropdownMenuItem>
  );
}
