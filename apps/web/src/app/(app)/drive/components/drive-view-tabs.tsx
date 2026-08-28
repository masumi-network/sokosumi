"use client";

import { useTranslations } from "next-intl";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type DrivePrimaryView = "recents" | "browse";

const TAB_TRIGGER_CLASS_NAME =
  "text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm";

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
      className="w-full"
    >
      <TabsList className="bg-muted/50 flex w-full items-center gap-1 self-start rounded-lg p-1 md:w-auto">
        <TabsTrigger value="recents" className={TAB_TRIGGER_CLASS_NAME}>
          {t("recentsTab")}
        </TabsTrigger>
        <TabsTrigger value="browse" className={TAB_TRIGGER_CLASS_NAME}>
          {browseLabel}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
