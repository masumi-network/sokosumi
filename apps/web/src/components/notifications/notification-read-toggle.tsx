"use client";

import { CheckCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNotifications } from "@/contexts/notification-provider";

interface NotificationReadToggleProps {
  notificationId: string;
  isRead: boolean;
  /** The row's own message, so a column of controls says what each acts on. */
  notificationMessage: string;
}

/**
 * The one control a notification row carries, in both frames.
 *
 * Reading a notification and acting on it are different things. Opening a row
 * navigates away, so a reader who has finished with a row but does not want to
 * open it needs a way to say so in place. This is it, and the way back out of
 * a read they did not mean.
 *
 * One control, never two: a row is in one state, and the only move worth
 * offering is the one that changes it. A double check marks a row read, the
 * read receipt of messaging apps. A dot marks it unread, the mark most apps
 * use for unread. The two shapes cannot be mistaken for each other at this size,
 * which two envelopes could, and the tooltip says the same thing in words,
 * because an icon alone is a guess.
 */
export function NotificationReadToggle({
  notificationId,
  isRead,
  notificationMessage,
}: NotificationReadToggleProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { markRead, markUnread } = useNotifications();

  function handleClick(): void {
    const change = isRead ? markUnread : markRead;
    change(notificationId).catch(() => {
      // The provider has already put the row back the way it was.
      toast.error(isRead ? t("markUnreadError") : t("markReadError"));
    });
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={
            isRead
              ? t("markUnread", { message: notificationMessage })
              : t("markRead", { message: notificationMessage })
          }
          className="text-muted-foreground size-8 shrink-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-focus-within/row:opacity-100"
          // A click must not leave focus here. The row shows this control
          // while focus is inside it, so a control that kept focus stayed on
          // screen after the pointer left. Tab and Enter still reach it.
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleClick}
        >
          {isRead ? (
            <span
              aria-hidden
              className="size-2 rounded-full bg-current forced-colors:bg-[ButtonText]"
            />
          ) : (
            <CheckCheck className="size-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {isRead ? t("markUnreadTooltip") : t("markReadTooltip")}
      </TooltipContent>
    </Tooltip>
  );
}
