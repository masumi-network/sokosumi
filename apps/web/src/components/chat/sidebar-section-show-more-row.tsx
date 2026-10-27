"use client";

import { ChevronUp, Ellipsis } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRowSlot,
} from "@/components/ui/sidebar";
import { SIDEBAR_ROW_LABEL_CLASS } from "@/components/ui/sidebar-classes";

/**
 * The last row of a sidebar section the room limit cut short: "Show N more"
 * lists the rest, "Show less" goes back to the limit. A plain sidebar row.
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
        aria-expanded={showAll}
        className="text-muted-foreground"
        onClick={() => onShowAllChange(!showAll)}
      >
        <SidebarRowSlot>
          <Icon aria-hidden />
        </SidebarRowSlot>
        <span className={SIDEBAR_ROW_LABEL_CLASS}>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
