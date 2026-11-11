"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef } from "react";
import { useNeedsYouTasks } from "@/components/notifications/notification-waiting-tasks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useNotifications } from "@/contexts/notification-provider";
import { isNotificationCenterView } from "@/contexts/notification-view-storage";
import { cn } from "@/lib/utils";

// The strip's bottom line is an inset shadow rather than a border, because
// the strip scrolls and a scroller clips whatever hangs into its border. The
// active tab's underline paints over that line, so the two are one line.
// The focus ring is inset for the same reason.
const TRIGGER_CLASS_NAME = cn(
  "text-muted-foreground hover:text-foreground focus-visible:ring-inset h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 pt-2 pb-2.5 text-sm font-medium shadow-none",
  "data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none",
  "dark:data-[state=active]:border-foreground dark:data-[state=active]:bg-transparent",
);

const COUNT_CLASS_NAME =
  "bg-muted text-foreground rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums";

interface NotificationCenterViewFilterProps {
  className?: string;
  /**
   * The rows the strip narrows. They render as the active tab's panel, so
   * each tab points at a panel that exists and a screen reader announces
   * the list as the tab's content.
   */
  children: ReactNode;
}

/**
 * The Notification Center's view strip, drawn once and used by both frames:
 * All, Unread, Needs you or Mentions, with a live count on the narrowed
 * views; Mentions counts the mentions still unread. A
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
 * requests: it lives on Needs you, so it counts on that tab, and so does
 * each Task waiting on the reader, by the number Home shows. The push primer
 * does not: it is an offer, and a blocked or iPhone browser would carry the
 * count for good.
 */
export function NotificationCenterViewFilter({
  className,
  children,
}: NotificationCenterViewFilterProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { view, setView, unreadCount, needsActionCount, mentionsCount } =
    useNotifications();
  const { notice } = useAccountNotice();
  const { data: waitingTasks } = useNeedsYouTasks();
  const needsYouCount =
    needsActionCount + (waitingTasks?.count ?? 0) + (notice !== null ? 1 : 0);
  const listRef = useRef<HTMLDivElement>(null);

  // Four labels do not fit the bell panel in every locale, so the strip
  // scrolls. A view chosen by click or restored on load must not sit past
  // the edge.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-state="active"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [view]);

  function handleValueChange(next: string): void {
    if (isNotificationCenterView(next)) {
      setView(next);
    }
  }

  return (
    <Tabs
      value={view}
      onValueChange={handleValueChange}
      className={cn("gap-0", className)}
    >
      <TabsList
        ref={listRef}
        aria-label={t("filterLabel")}
        className="shadow-border h-auto w-full justify-start gap-4 overflow-x-auto rounded-none bg-transparent p-0 px-4 shadow-[inset_0_-1px_0] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
        <TabsTrigger value="mentions" className={TRIGGER_CLASS_NAME}>
          {t("filterMentions")}
          {mentionsCount > 0 ? (
            <span className={COUNT_CLASS_NAME}>{mentionsCount}</span>
          ) : null}
        </TabsTrigger>
      </TabsList>
      {/* One panel for whichever view is on: the views are one list under
          four lenses, not four lists. Out of the Tab order, because the rows
          inside it are the stops and a focus ring on the whole list says
          nothing. */}
      <TabsContent value={view} tabIndex={-1}>
        {children}
      </TabsContent>
    </Tabs>
  );
}
