"use client";

import { Play, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoGettingStarted({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const { data } = model;
  if (model.filters.from || model.filters.to) {
    return (
      <section className={cn(HOLDER_ITEM_CLASS, "space-y-4 p-5 sm:p-6")}>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">
            {t("overview.noMeasuredReports")}
          </h2>
          <p className="text-muted-foreground max-w-prose text-sm">
            {t("overview.noMeasuredReportsBody")}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void model.setFilters({ from: null, to: null });
          }}
        >
          {t("overview.clearActivityDates")}
        </Button>
      </section>
    );
  }
  if (!data.availableActions.canEdit) return null;
  return (
    <section className={cn(HOLDER_ITEM_CLASS, "space-y-4 p-5 sm:p-6")}>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{t("overview.getStarted")}</h2>
        <p className="text-muted-foreground max-w-prose text-sm">
          {t(
            data.availableActions.canRequestAnalysis
              ? "overview.getStartedBody"
              : data.scope.pageIds.length
                ? "overview.getStartedUnavailable"
                : "overview.getStartedNoPages",
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {data.availableActions.canRequestAnalysis ? (
          <Button
            onClick={() => model.setDialog("analysis")}
            disabled={!data.scope.pageIds.length}
          >
            <Play className="size-4" />
            {t("runAnalysis")}
          </Button>
        ) : null}
        <Button
          variant={
            data.availableActions.canRequestAnalysis ? "outline" : "default"
          }
          onClick={() => model.setDialog("page")}
        >
          <Plus className="size-4" />
          {t("addPage")}
        </Button>
      </div>
    </section>
  );
}
