import { CalendarClock } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import AgentIcon from "@/components/agents/agent-icon";
import {
  computeScheduleTitleInfo,
  formatScheduleTitle,
  TranslateFn,
} from "@/components/schedules/format";
import ScheduleItem from "@/components/schedules/schedule-item.client";
import { getSession } from "@/lib/auth/utils";
import {
  jobScheduleRepository,
  type ScheduleListItem,
} from "@/lib/db/repositories";
import { JobScheduleType, mapPrismaToUiScheduleType } from "@/lib/db/types/job";

export default async function SchedulesPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const schedules = await jobScheduleRepository.getScheduleJobsByContext(
    session.user.id,
    session.session.activeOrganizationId ?? null,
  );

  const t = await getTranslations("App.Schedules");
  const tScheduler = await getTranslations(
    "App.Agents.Jobs.CreateJob.Scheduler",
  );

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-light">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <Suspense fallback={<div>{t("loading")}</div>}>
        <div className="mt-4 space-y-6">
          {schedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center space-y-3 py-16 text-center">
              <CalendarClock
                className="text-muted-foreground size-12"
                aria-hidden
              />
              <h2 className="text-xl font-medium">{t("empty.title")}</h2>
              <p className="text-muted-foreground max-w-md">
                {t("empty.description")}
              </p>
            </div>
          ) : (
            Object.values(
              schedules.reduce(
                (acc, s) => {
                  const key = s.agentId;
                  if (!acc[key])
                    acc[key] = {
                      agentName: s.agent.name,
                      agent: s.agent,
                      items: [] as typeof schedules,
                    };
                  acc[key].items.push(s);
                  return acc;
                },
                {} as Record<
                  string,
                  {
                    agentName: string;
                    agent: (typeof schedules)[number]["agent"];
                    items: typeof schedules;
                  }
                >,
              ),
            ).map((group) => {
              return (
                <div key={group.agentName} className="space-y-3">
                  <div className="text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <AgentIcon agent={group.agent} />
                      <span className="truncate">{group.agentName}</span>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-1">
                    {group.items.map((s: ScheduleListItem) => {
                      const scheduleType: JobScheduleType =
                        mapPrismaToUiScheduleType(s.scheduleType);
                      const info = computeScheduleTitleInfo({
                        scheduleType,
                        cron: s.cron ?? null,
                        timezone: s.timezone,
                      });
                      const title = formatScheduleTitle(
                        info,
                        tScheduler as TranslateFn,
                      );

                      const latestJobCreatedAt =
                        s.jobs?.pop()?.createdAt ?? null;
                      return (
                        <ScheduleItem
                          key={s.id}
                          schedule={{
                            id: s.id,
                            scheduleType,
                            cron: s.cron ?? null,
                            oneTimeAtUtc: s.oneTimeAtUtc ?? null,
                            timezone: s.timezone,
                            endOnUtc: s.endOnUtc ?? null,
                            endAfterOccurrences: s.endAfterOccurrences ?? null,
                            isActive: s.isActive,
                            lastRunAt: latestJobCreatedAt,
                            nextRunAt: s.nextRunAt ?? null,
                            input: s.input ?? null,
                            inputSchema: s.inputSchema ?? null,
                            pauseReason: s.pauseReason ?? null,
                          }}
                          title={title}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Suspense>
    </div>
  );
}
