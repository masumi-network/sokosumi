"use client";

import { useTranslations } from "next-intl";

import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type DrivePrimaryView = "recents" | "browse" | "tables";

interface DriveViewTabsProps {
  activeView: DrivePrimaryView;
  browseLabel: string;
  onViewChange: (view: DrivePrimaryView) => void;
}

export function DriveViewTabs({
  activeView,
  browseLabel,
  onViewChange,
}: DriveViewTabsProps) {
  const t = useTranslations("App.Drive");

  return (
    <Tabs
      value={activeView}
      onValueChange={(value) => {
        onViewChange(value as DrivePrimaryView);
      }}
      className="w-full @2xl:w-auto"
    >
      <TabsList className={cn(SEGMENTED_TABS_LIST_CLASS_NAME, "@2xl:w-auto")}>
        <TabsTrigger
          value="recents"
          className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
        >
          {t("recentsTab")}
        </TabsTrigger>
        <TabsTrigger
          value="browse"
          className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
        >
          {browseLabel}
        </TabsTrigger>
        <TabsTrigger
          value="tables"
          className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
        >
          {t("tablesTab")}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
