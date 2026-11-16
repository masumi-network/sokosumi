"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** No check falls inside the chosen activity dates: offer to clear them. First-run setup lives in SeoSetupCard. */
export function SeoGettingStarted({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  if (model.filters.from || model.filters.to) {
    return (
      <section className={cn(HOLDER_ITEM_CLASS, "space-y-4 p-4")}>
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
  return null;
}
