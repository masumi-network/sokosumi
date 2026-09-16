"use client";

import { useTranslations } from "next-intl";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useNotifications } from "@/contexts/notification-provider";

/**
 * The Notification Center's view switch: All or Unread, drawn once and used
 * by both frames. A lens, not a write: switching refetches under the new
 * view and never marks anything read.
 *
 * Small on purpose: it sits next to Mark all read in the panel's header row
 * and on the page's action row, and neither row grows taller for it.
 */
export function NotificationCenterViewFilter() {
  const t = useTranslations("Components.NotificationCenter");
  const { view, setView } = useNotifications();

  function handleValueChange(next: string): void {
    // Single required value: clicking the active option clears the group's
    // value, and the list keeps the view it has.
    if (next === "all" || next === "unread") {
      setView(next);
    }
  }

  return (
    <ToggleGroup
      type="single"
      value={view}
      aria-label={t("filterLabel")}
      onValueChange={handleValueChange}
      variant="outline"
      size="sm"
      className="shrink-0"
    >
      <ToggleGroupItem value="all" className="h-6 px-2 text-xs">
        {t("filterAll")}
      </ToggleGroupItem>
      <ToggleGroupItem value="unread" className="h-6 px-2 text-xs">
        {t("filterUnread")}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
