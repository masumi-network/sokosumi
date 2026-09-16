"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/contexts/notification-provider";

/**
 * The Notification Center's Unread lens, drawn once and used by both frames.
 * A lens, not a write: pressing it refetches under the narrowed view and
 * never marks anything read.
 *
 * One pressed chip rather than an All/Unread pair. All is the resting state
 * of the list, so it needs no button of its own, and the header row keeps
 * room for Mark all read beside it. The dot and the pressed fill take the
 * unread colour, the same purple as the rail on an unread row, so the chip
 * and the rows it narrows to say "unread" in one voice. The count is the
 * reason to press it, and it leaves with the last unread row.
 */
export function NotificationCenterViewFilter() {
  const t = useTranslations("Components.NotificationCenter");
  const { view, setView, unreadCount } = useNotifications();
  const isPressed = view === "unread";

  function handleClick(): void {
    setView(isPressed ? "all" : "unread");
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={isPressed}
      onClick={handleClick}
      className="group/filter text-muted-foreground hover:text-foreground aria-pressed:border-primary-quaternary aria-pressed:bg-primary-quinary aria-pressed:text-primary aria-pressed:hover:bg-primary-quaternary aria-pressed:hover:text-primary h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-xs"
    >
      <span
        aria-hidden
        className="bg-quaternary group-aria-pressed/filter:bg-primary size-2 rounded-full"
      />
      {t("filterUnread")}
      {unreadCount > 0 ? (
        <span className="tabular-nums">{unreadCount}</span>
      ) : null}
    </Button>
  );
}
