"use client";

import type { ProjectSeoMonitor } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ScheduleWhen } from "@/lib/schedules/schedule-when";
import {
  seoMonitorRuleBelowReleased,
  seoMonitorRuleOf,
  seoMonitorWhen,
} from "./seo-monitor-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export type SeoMonitorStateAction = "pause" | "resume" | "end";

/** One monitor row: its commands and the state of its inline rule editor. */
export function useSeoMonitor(
  model: SeoWorkspaceModel,
  monitor: ProjectSeoMonitor,
) {
  const t = useTranslations("App.Seo.monitor");
  const [when, setWhen] = useState<ScheduleWhen | null>(null);
  const rule = when ? seoMonitorRuleOf(when) : null;
  const belowReleased = rule
    ? seoMonitorRuleBelowReleased(rule, monitor.releasedCount)
    : false;
  return {
    pending: model.pending,
    editing: when !== null,
    when,
    setWhen,
    /** The edit can be saved: a complete rule that keeps the Runs the monitor already made. */
    canSave: rule !== null && !belowReleased,
    belowReleased,
    startEdit: () =>
      setWhen(seoMonitorWhen(monitor.rule, monitor.rule.timezone)),
    cancelEdit: () => setWhen(null),
    async save() {
      if (!rule || belowReleased) return;
      const saved = await model.execute(
        {
          kind: "monitor_update",
          monitorId: monitor.id,
          expectedRevision: monitor.revision,
          rule,
        },
        t("done.update"),
      );
      if (saved) setWhen(null);
    },
    changeState: (action: SeoMonitorStateAction) =>
      model.execute(
        { kind: "monitor_state", monitorId: monitor.id, action },
        t(`done.${action}`),
      ),
    runNow: () =>
      model.execute(
        {
          kind: "monitor_run_now",
          monitorId: monitor.id,
          expectedRevision: monitor.revision,
        },
        t("done.runNow"),
      ),
  };
}
