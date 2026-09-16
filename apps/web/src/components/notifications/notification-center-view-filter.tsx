"use client";

import { useTranslations } from "next-intl";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useNotifications } from "@/contexts/notification-provider";

/**
 * The Notification Center's view switch: All or Unread, drawn once and used
 * by both frames. A lens, not a write: switching refetches under the new
 * view and never marks anything read.
 *
 * A compact take on the app's segmented-control recipe (muted pill, active
 * option in background with a shadow): it sits next to Mark all read in the
 * panel's header row and on the page's action row, and neither row grows
 * taller for it.
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
      className="bg-muted/50 shrink-0 gap-0.5 rounded-lg p-0.5"
    >
      <ToggleGroupItem
        value="all"
        className="text-muted-foreground h-auto rounded-md px-2 py-px text-xs first:rounded-md last:rounded-md hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-background"
      >
        {t("filterAll")}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="unread"
        className="text-muted-foreground h-auto rounded-md px-2 py-px text-xs first:rounded-md last:rounded-md hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-background"
      >
        {t("filterUnread")}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
