"use client";

import {
  AlertTriangle,
  AtSign,
  CalendarDays,
  ChartColumn,
  type LucideIcon,
  PencilLine,
} from "lucide-react";

import { CornerCountBadge } from "@/components/common/corner-count-badge";
import { TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import type { SocialTab } from "./constants";

const SOCIAL_TAB_ICONS: Record<SocialTab, LucideIcon> = {
  calendar: CalendarDays,
  drafts: PencilLine,
  attention: AlertTriangle,
  statistics: ChartColumn,
  accounts: AtSign,
};

/**
 * The tab list's wrapper: the `@container` the tabs measure themselves
 * against. Viewport breakpoints would not do: the row's room depends on the
 * sidebar and on the page actions beside it, not on the screen alone.
 */
export const SOCIAL_TABS_ROW_CLASS_NAME = "@container flex min-w-0 flex-1";

/**
 * Social's tab list. Five labels (up to ~39rem in Spanish, with counts) do
 * not fit a phone, or a narrow column beside the sidebar, so below 42rem of
 * room the list fills its row as one segmented control of icons instead of
 * scrolling sideways.
 */
export const SOCIAL_TABS_LIST_CLASS_NAME =
  "w-fit min-w-0 max-w-full @max-[42rem]:h-auto @max-[42rem]:w-full";

/**
 * One of Social's tabs. Where the labels do not fit it is an icon with its
 * count on the corner; the full name (and count) stays in the tab as
 * screen-reader text, so the tab is announced exactly as with the labels.
 */
export function SocialTabTrigger({
  tab,
  label,
  count,
  alert = false,
}: {
  tab: SocialTab;
  label: string;
  /** Shown beside the label, e.g. `3` or `20+`. */
  count?: string | null;
  /** Needs attention with something in it: the warning glyph shows on desktop too. */
  alert?: boolean;
}) {
  const Icon = SOCIAL_TAB_ICONS[tab];
  return (
    <TabsTrigger
      className={cn(
        "@max-[42rem]:min-h-11 @max-[42rem]:min-w-0 @max-[42rem]:px-0",
      )}
      data-testid={`social-posts-tab-${tab}`}
      value={tab}
    >
      <span
        className={cn("relative flex", !alert && "@min-[42rem]:hidden")}
        data-testid="social-posts-tab-icon"
      >
        <Icon
          aria-hidden
          className={cn("size-4", alert && "text-semantic-warning")}
        />
        {count ? (
          <CornerCountBadge className="bg-muted text-foreground -top-2 -right-3 @min-[42rem]:hidden">
            {count}
          </CornerCountBadge>
        ) : null}
      </span>
      <span className="@max-[42rem]:sr-only">{label}</span>
      {count ? (
        <>
          {" "}
          <span className="text-muted-foreground tabular-nums @max-[42rem]:sr-only">
            {count}
          </span>
        </>
      ) : null}
    </TabsTrigger>
  );
}
