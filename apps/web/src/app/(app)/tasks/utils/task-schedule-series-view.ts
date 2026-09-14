import {
  hasActiveTaskSchedule,
  parseTaskScheduleMetadata,
} from "@sokosumi/utils";

import type { ScheduleTitleInput } from "@/components/schedules/format";
import { HYDRATION_STABLE_TIME_ZONE } from "@/lib/utils/datetime";

export interface TaskScheduleSeriesViewInput {
  metadata: string | null | undefined;
  nextRunAt: Date | string | null | undefined;
  /** Series revision from the Task DTO. A removed series keeps a positive one. */
  scheduleRevision: number | undefined;
  /** Project the series releases into; null for the workspace Calendar. */
  project: { id: string; name: string } | null;
  /** Already-translated workspace Calendar name. */
  workspaceName: string;
}

export interface TaskScheduleSeriesView {
  isActive: boolean;
  calendar: {
    name: string;
    href: string;
    source: "PROJECT" | "WORKSPACE";
  };
  /** Inputs for `computeScheduleTitleInfo`; null once the series was removed. */
  rule: ScheduleTitleInput | null;
  /** Zone the rule was captured with. A legacy v1 one-time rule carries none. */
  timezone: string | null;
}

/**
 * Decides whether Task detail shows a schedule series at all, and maps the Task
 * onto the summary the section renders.
 *
 * A Task that never carried a schedule has nothing to show. A removed series
 * keeps its revision, and with it the history the removal preserved, so it
 * still shows — only its rule rows go away.
 */
export function buildTaskScheduleSeriesView({
  metadata,
  nextRunAt,
  scheduleRevision,
  project,
  workspaceName,
}: TaskScheduleSeriesViewInput): TaskScheduleSeriesView | null {
  const isActive = hasActiveTaskSchedule(metadata, nextRunAt);
  if (!isActive && (scheduleRevision ?? 0) === 0) {
    return null;
  }

  const scheduleMetadata = parseTaskScheduleMetadata(metadata);
  // Only a v1 one-time rule carries no zone of its own.
  const timezone =
    scheduleMetadata && "timezone" in scheduleMetadata
      ? scheduleMetadata.timezone
      : null;

  return {
    isActive,
    calendar: project
      ? {
          name: project.name,
          href: `/projects/${project.id}/calendar`,
          source: "PROJECT",
        }
      : { name: workspaceName, href: "/calendar", source: "WORKSPACE" },
    rule: scheduleMetadata
      ? {
          scheduleType: scheduleMetadata.mode === "once" ? "ONE_TIME" : "CRON",
          cron:
            scheduleMetadata.mode === "recurring"
              ? scheduleMetadata.expr
              : null,
          timezone: timezone ?? HYDRATION_STABLE_TIME_ZONE,
        }
      : null,
    timezone,
  };
}
