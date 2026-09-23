"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useNotifications } from "@/contexts/notification-provider";
import { cn } from "@/lib/utils";

// The underline hangs one pixel below the strip, over the strip's own border,
// so the active tab's line and the list's top edge are one line.
const TRIGGER_CLASS_NAME = cn(
  "text-muted-foreground hover:text-foreground -mb-px h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 pt-2 pb-2.5 text-sm font-medium shadow-none",
  "data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none",
  "dark:data-[state=active]:border-primary dark:data-[state=active]:bg-transparent",
);

const COUNT_CLASS_NAME =
  "bg-primary-quinary text-primary rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums";

interface NotificationCenterViewFilterProps {
  className?: string;
}

/**
 * The Notification Center's view strip, drawn once and used by both frames:
 * All, Unread or Needs you, with a live count on the two narrowed views. A
 * lens, not a write: switching refetches under the new view and never marks
 * anything read.
 *
 * A strip of tabs rather than a segmented pill, because it sits directly on
 * the list it narrows and its bottom edge is the line above the first row.
 * The active tab's underline takes the unread colour, the same purple as
 * the rail on an unread row, so the strip and the rows say "unread" in one
 * voice. A single-choice control on purpose: each view is a different list.
 * Needs you is not "unread": a row stays there, read or not, until the
 * request it stands for is answered. An account notice is one of those
 * requests: it lives on Needs you, so it counts on that tab. The push primer
 * does not: it is an offer, and a blocked or iPhone browser would carry the
 * count for good.
 */
export function NotificationCenterViewFilter({
  className,
}: NotificationCenterViewFilterProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { view, setView, unreadCount, needsActionCount } = useNotifications();
  const { notice } = useAccountNotice();
  const needsYouCount = needsActionCount + (notice !== null ? 1 : 0);

  function handleValueChange(next: string): void {
    if (next === "all" || next === "unread" || next === "needs-action") {
      setView(next);
    }
  }

  return (
    <Tabs value={view} onValueChange={handleValueChange} className={className}>
      <TabsList
        aria-label={t("filterLabel")}
        className="border-border h-auto w-full justify-start gap-4 rounded-none border-b bg-transparent p-0 px-4"
      >
        <TabsTrigger value="all" className={TRIGGER_CLASS_NAME}>
          {t("filterAll")}
        </TabsTrigger>
        <TabsTrigger value="unread" className={TRIGGER_CLASS_NAME}>
          {t("filterUnread")}
          {unreadCount > 0 ? (
            <span className={COUNT_CLASS_NAME}>{unreadCount}</span>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="needs-action" className={TRIGGER_CLASS_NAME}>
          {t("filterNeedsYou")}
          {needsYouCount > 0 ? (
            <span className={COUNT_CLASS_NAME}>{needsYouCount}</span>
          ) : null}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
