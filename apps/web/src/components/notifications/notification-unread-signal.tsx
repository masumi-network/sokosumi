import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface NotificationUnreadRailProps {
  isRead: boolean;
}

/**
 * The bar on a notification row's leading edge that marks the row unread.
 *
 * Shared by the bell dropdown and the notifications page, because the two
 * list the same rows and a reader moving between them should not have to
 * learn the signal twice.
 *
 * The geometry never changes between the two states. A rail that appeared
 * only when unread, or that changed width, would move the message sideways
 * the moment a row was marked read, and every row below it with it.
 *
 * A background rather than a left border, so the bar survives forced colors
 * mode. That mode keeps the alpha of a background-color, which leaves the
 * read row's rail invisible, but it forces a border-color outright and would
 * have painted both states the same bar. It repaints bg-primary as Canvas,
 * the colour of the row behind it, so the unread rail names Highlight there.
 */
export function NotificationUnreadRail({
  isRead,
}: NotificationUnreadRailProps) {
  return (
    <span
      className={cn(
        "w-0.5 shrink-0 self-stretch",
        isRead ? "bg-transparent" : "bg-primary forced-colors:bg-[Highlight]",
      )}
      aria-hidden
    />
  );
}

interface NotificationUnreadLabelProps {
  isRead: boolean;
}

/**
 * The spoken half of the same signal, for a reader who gets none of the
 * colour. Render it as the first child of the row's text column: it names
 * the state ahead of the message rather than trailing it.
 *
 * Shared with the rail so the two cannot disagree about which rows are
 * unread, and so the wording is written once.
 */
export function NotificationUnreadLabel({
  isRead,
}: NotificationUnreadLabelProps) {
  const t = useTranslations("Components.NotificationCenter");

  if (isRead) {
    return null;
  }

  return <span className="sr-only">{t("unreadIndicator")}</span>;
}
