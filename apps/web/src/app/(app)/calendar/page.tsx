import { format } from "date-fns";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { getSession } from "@/lib/auth/auth.server";
import { isBetaAccessEmail } from "@/lib/beta-access";
import { TaskStatus } from "@/lib/clients/generated/core";
import {
  getCalendarRange,
  getLatestCalendarDate,
  resolveCalendarDate,
} from "@/lib/schedules/calendar-range";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";

interface CalendarPageProps {
  searchParams: Promise<{
    assigneeId?: string;
    date?: string;
    projectId?: string;
    sourceId?: string;
    scope?: string;
    status?: string;
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Calendar.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function CalendarPage({
  searchParams,
}: CalendarPageProps) {
  await connection();
  const session = await getSession();
  if (!isBetaAccessEmail(session?.user.email)) {
    notFound();
  }

  const { assigneeId, date, projectId, sourceId, scope, status } =
    await searchParams;
  const calendarStatus = Object.values(TaskStatus).find(
    (taskStatus) => taskStatus === status,
  );
  const now = new Date();
  const latestCalendarDate = getLatestCalendarDate(now);
  const initialDate = resolveCalendarDate(date, now);
  const range = getCalendarRange(initialDate);
  const [{ items, pagination }, sources, coworkers] = await Promise.all([
    taskService.getWorkspaceCalendar({
      ...range,
      assigneeId,
      limit: 100,
      projectId,
      sourceId,
      scope: scope === "owned" ? "owned" : "workspace",
      status: calendarStatus,
    }),
    taskService.getWorkspaceCalendarSources(),
    coworkerService.listCoworkers().catch(() => []),
  ]);

  return (
    <div className="w-full px-2">
      <WorkspaceCalendar
        activeOrganizationId={session?.session?.activeOrganizationId ?? null}
        key={`${initialDate}-${projectId ?? "all"}-${sourceId ?? "all"}-${scope ?? "workspace"}-${assigneeId ?? "all"}-${calendarStatus ?? "all"}`}
        initialDate={initialDate}
        items={items}
        latestDate={format(latestCalendarDate, "yyyy-MM-dd")}
        sources={sources}
        pagination={pagination}
        range={range}
        coworkers={getCoworkerOptions(coworkers).map((coworker) => ({
          id: coworker.id,
          image: coworker.image,
          name: coworker.name,
        }))}
      />
    </div>
  );
}
