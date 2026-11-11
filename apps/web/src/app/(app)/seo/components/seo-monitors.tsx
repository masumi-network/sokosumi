"use client";

import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoDate, SeoState } from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Scheduled checks on the agent's home: off until the owner turns them on; the schedule page holds the details. Nothing shows when no schedule exists and the workspace cannot make one. */
export function SeoAutomation({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const scheduleT = useTranslations("App.Tasks.Schedules");
  const { monitors, availableActions, scope } = model.data;
  const canCreate = availableActions.canCreateMonitor === true;
  // No schedule and no way to make one: nothing to show and nothing to act on.
  if (!monitors.length && !canCreate) return null;
  return (
    <div
      className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-4")}
      data-testid="seo-automation"
    >
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold">{t("monitor.title")}</h3>
          {monitors.length ? null : (
            <p className="text-muted-foreground text-sm">
              {t("monitor.offBody")}
            </p>
          )}
        </div>
      </div>
      {monitors.length ? (
        <ul className="space-y-2">
          {monitors.map((monitor) => (
            <li
              key={monitor.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium break-words">{monitor.name}</span>
                <SeoState>
                  {scheduleT.has(`state.${monitor.state}`)
                    ? scheduleT(`state.${monitor.state}`)
                    : monitor.state}
                </SeoState>
                <span className="text-muted-foreground">
                  {t("monitor.next")}:{" "}
                  <SeoDate
                    value={monitor.nextRunAt}
                    timeZone={monitor.timeZone}
                  />{" "}
                  ({monitor.timeZone})
                </span>
              </span>
              <Link
                href={`/schedules/${encodeURIComponent(monitor.id)}`}
                className="py-1 underline underline-offset-4"
              >
                {t("monitor.manage")}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={!scope.pageIds.length}
          onClick={() => model.setDialog("monitor")}
        >
          <CalendarClock />
          {t("monitor.agentWeekly")}
        </Button>
      )}
    </div>
  );
}
