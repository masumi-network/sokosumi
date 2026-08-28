import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";

interface CalendarPageProps {
  searchParams: Promise<{ date?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Calendar.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

function getCalendarRange(dateParam: string) {
  const date = new Date(`${dateParam}T12:00:00`);
  // Pad the rendered month grid by a day on each side for client timezones.
  const from = addDays(startOfWeek(startOfMonth(date)), -1);
  const to = addDays(endOfWeek(endOfMonth(date)), 2);

  return { from, to };
}

function getLatestCalendarDate(now: Date): Date {
  const horizon = addDays(now, 90);
  const candidate = startOfMonth(horizon);
  const candidateRange = getCalendarRange(format(candidate, "yyyy-MM-dd"));

  return candidateRange.to <= horizon ? candidate : subMonths(candidate, 1);
}

function resolveCalendarDate(dateParam: string | undefined, now: Date): string {
  const parsedDate = dateParam ? new Date(`${dateParam}T12:00:00`) : now;
  const date = Number.isNaN(parsedDate.getTime()) ? now : parsedDate;
  const latestCalendarDate = getLatestCalendarDate(now);
  return format(
    date > latestCalendarDate ? latestCalendarDate : date,
    "yyyy-MM-dd",
  );
}

export default async function CalendarPage({
  searchParams,
}: CalendarPageProps) {
  await connection();

  const { date } = await searchParams;
  const now = new Date();
  const latestCalendarDate = getLatestCalendarDate(now);
  const initialDate = resolveCalendarDate(date, now);
  const range = getCalendarRange(initialDate);
  const [{ items, pagination }, sources, coworkers] = await Promise.all([
    taskService.getWorkspaceCalendar({
      ...range,
      limit: 100,
    }),
    taskService.getWorkspaceCalendarSources(),
    coworkerService.listCoworkers().catch(() => []),
  ]);

  return (
    <div className="w-full px-2">
      <WorkspaceCalendar
        key={initialDate}
        initialDate={initialDate}
        items={items}
        latestDate={format(latestCalendarDate, "yyyy-MM-dd")}
        sources={sources}
        pagination={pagination}
        range={range}
        coworkers={coworkers.map((coworker) => ({
          id: coworker.id,
          name: coworker.name,
        }))}
      />
    </div>
  );
}
