"use client";

import { ChevronUp, Ellipsis } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRowSlot,
} from "@/components/ui/sidebar";
import {
  SIDEBAR_ROW_FIXED_LABEL_CLASS,
  SIDEBAR_ROW_LABEL_CLASS,
} from "@/components/ui/sidebar-classes";
import { cn } from "@/lib/utils";

/**
 * The last row of a sidebar section the room limit cut short: "Show N more"
 * lists the rest, "Show less" goes back to the limit. A plain sidebar row, so
 * on the rail it is a square with the label as its tooltip.
 */
export function SidebarSectionShowMoreRow({
  hiddenCount,
  showAll,
  onShowAllChange,
}: {
  hiddenCount: number;
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
}) {
  const t = useTranslations("App.Channels.SectionLimit");
  const label = showAll ? t("showLess") : t("showMore", { count: hiddenCount });
  const Icon = showAll ? ChevronUp : Ellipsis;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        tooltip={label}
        aria-expanded={showAll}
        className="text-muted-foreground"
        onClick={() => onShowAllChange(!showAll)}
      >
        <SidebarRowSlot>
          <Icon className="size-4" aria-hidden />
        </SidebarRowSlot>
        <span
          className={cn(SIDEBAR_ROW_LABEL_CLASS, SIDEBAR_ROW_FIXED_LABEL_CLASS)}
        >
          {label}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
