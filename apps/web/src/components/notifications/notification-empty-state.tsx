"use client";

import { BellOff, CheckCheck, Inbox, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { NotificationCenterView } from "@/contexts/notification-state";

/**
 * One row per view, so a view added later has one place to answer rather
 * than three ternaries to thread through. `isNarrowed` marks an empty that
 * is a lens over rows All still holds.
 */
const EMPTY_COPY = {
  all: {
    icon: BellOff,
    title: "emptyState",
    description: "emptyStateDescription",
    isNarrowed: false,
  },
  unread: {
    icon: CheckCheck,
    title: "emptyUnreadState",
    description: "emptyUnreadStateDescription",
    isNarrowed: true,
  },
  "needs-action": {
    icon: Inbox,
    title: "emptyNeedsYouState",
    description: "emptyNeedsYouStateDescription",
    isNarrowed: true,
  },
} as const satisfies Record<
  NotificationCenterView,
  {
    icon: LucideIcon;
    title: string;
    description: string;
    isNarrowed: boolean;
  }
>;

interface NotificationEmptyStateProps {
  view: NotificationCenterView;
  /**
   * Puts the reader back in the view that still holds their rows. It takes
   * the button that asked, because that button leaves with this empty
   * state and something has to inherit its focus.
   */
  onShowAll: (trigger: HTMLElement) => void;
}

/**
 * What the Notification Center says when it has nothing to list.
 *
 * Three empties, three different things to say. An empty All is a reader
 * who has never been sent anything, so it says what will arrive here. An
 * empty Unread or Needs you is a narrowed lens over rows that still exist,
 * so each one says where those rows went and offers the way back. Without
 * that, the shortest reading of "You're all caught up" is that the list was
 * emptied.
 *
 * The page's permission primer already offers the push pitch above this
 * card, so nothing here repeats it. The way back is labelled "Show all",
 * not "View all notifications": the panel's footer link already carries
 * those words, and it goes to the page rather than switching the view.
 */
export function NotificationEmptyState({
  view,
  onShowAll,
}: NotificationEmptyStateProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { icon: Icon, title, description, isNarrowed } = EMPTY_COPY[view];

  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <span
        className="bg-quinary text-muted-foreground mb-2 flex size-10 items-center justify-center rounded-full"
        aria-hidden
      >
        <Icon className="size-5" />
      </span>
      <p className="text-sm font-semibold">{t(title)}</p>
      <p className="text-muted-foreground max-w-[44ch] text-xs text-pretty">
        {t(description)}
      </p>
      {isNarrowed ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3"
          onClick={(event) => onShowAll(event.currentTarget)}
        >
          {t("showAll")}
        </Button>
      ) : null}
    </div>
  );
}
