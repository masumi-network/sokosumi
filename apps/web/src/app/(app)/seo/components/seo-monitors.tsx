"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { SeoDate, SeoEmpty, SeoSection, SeoState } from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoMonitors({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const scheduleT = useTranslations("App.Tasks.Schedules");
  return (
    <SeoSection
      title={t("monitor.title")}
      actions={
        model.data.availableActions.canRequestAnalysis ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!model.data.scope.pageIds.length}
            onClick={() => model.setDialog("monitor")}
          >
            {t("monitor.create")}
          </Button>
        ) : null
      }
    >
      <p className="text-muted-foreground px-2 pb-2 text-sm">
        {t("monitor.help")}
      </p>
      {model.data.monitors.length ? (
        <ul className="grid gap-2 md:grid-cols-2">
          {model.data.monitors.map((monitor) => (
            <li
              className={`${HOLDER_ITEM_CLASS} space-y-3 p-4`}
              key={monitor.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{monitor.name}</h3>
                <SeoState>
                  {scheduleT.has(`state.${monitor.state}`)
                    ? scheduleT(`state.${monitor.state}`)
                    : monitor.state}
                </SeoState>
              </div>
              <p className="text-muted-foreground text-sm">
                {t(`analysis.${monitor.kind}`)} · {monitor.countryCode} /{" "}
                {monitor.languageCode} ·{" "}
                {monitor.devices
                  .map((device) => t(`analysis.${device}`))
                  .join(", ")}
              </p>
              <p className="text-muted-foreground text-sm">
                {t("monitor.progress", {
                  count: monitor.releasedCount,
                  total: monitor.targetRunCount,
                })}{" "}
                · {t("pages.count", { count: monitor.pageIds.length })}
              </p>
              <p className="text-muted-foreground text-sm">
                {t("monitor.perRun", { count: monitor.maxProviderCalls })}
              </p>
              <p className="text-muted-foreground text-sm">
                {t("monitor.next")}:{" "}
                <SeoDate
                  value={monitor.nextRunAt}
                  timeZone={monitor.timeZone}
                />{" "}
                ({monitor.timeZone})
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/schedules/${encodeURIComponent(monitor.id)}`}>
                  {t("monitor.manage")}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <SeoEmpty title={t("monitor.empty")} body={t("monitor.emptyBody")} />
      )}
    </SeoSection>
  );
}
