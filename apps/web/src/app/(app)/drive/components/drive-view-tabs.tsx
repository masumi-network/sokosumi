"use client";

import { useTranslations } from "next-intl";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * Three tabs, and Workspace *is* the catalog.
 *
 * There were four: an "All files" tab holding the searchable catalog and a
 * "Workspace" tab holding the folder tree. Both listed the same files, and two
 * tabs listing the same files is the defect rather than the feature. Workspace
 * now holds the catalog — searchable, filterable, every file — with folder
 * navigation nested inside it as a scope, so folders and folder management
 * survive the merge.
 *
 * `all` and `browse` are still accepted in the URL by `drive-page-client`,
 * because links to both shipped. Neither is a tab any more.
 */
export type DrivePrimaryView = "recents" | "workspace" | "tables";

interface DriveViewTabsProps {
  activeView: DrivePrimaryView;
  onViewChange: (view: DrivePrimaryView) => void;
}

export function DriveViewTabs({
  activeView,
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
      <TabsList className={cn("@2xl:w-auto")}>
        <TabsTrigger value="recents">{t("recentsTab")}</TabsTrigger>
        <TabsTrigger value="workspace">{t("workspaceTab")}</TabsTrigger>
        <TabsTrigger value="tables">{t("tablesTab")}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
