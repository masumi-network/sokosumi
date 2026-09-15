"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { useDeleteNotification } from "@/components/notifications/use-delete-notification";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DeleteNotificationMenuItemProps {
  notificationId: string;
  isRead: boolean;
  /** The row's own message, so a column of controls says what each removes. */
  notificationMessage: string;
}

/**
 * The control that removes one notification for good, in the bell dropdown.
 *
 * A menu item of its own rather than a button inside the row's item: arrow
 * keys reach it, and each element in the menu keeps one role.
 *
 * The icon is a bin, not a close glyph: this removes the notification rather
 * than dismissing the panel, and the tooltip says so in words.
 */
export function DeleteNotificationMenuItem({
  notificationId,
  isRead,
  notificationMessage,
}: DeleteNotificationMenuItemProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { requestDelete } = useDeleteNotification(notificationId, isRead);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem
          aria-label={t("delete", { message: notificationMessage })}
          className="text-muted-foreground focus:bg-foreground/10 focus:text-foreground my-2 mr-2.5 size-7 shrink-0 justify-center p-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-has-[[data-highlighted]]/row:opacity-100"
          onSelect={(event) => {
            // The menu stays open, because one delete is rarely the only one.
            event.preventDefault();
            void requestDelete();
          }}
        >
          <Trash2 className="size-4" />
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {t("deleteTooltip")}
      </TooltipContent>
    </Tooltip>
  );
}
