import {
  addDays,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
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

function getCalendarRange(dateParam: string | undefined) {
  const parsedDate = dateParam ? new Date(`${dateParam}T12:00:00`) : new Date();
  const date = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  // Pad the rendered month grid by a day on each side for client timezones.
  const from = addDays(startOfWeek(startOfMonth(date)), -1);
  const to = addDays(endOfWeek(endOfMonth(date)), 2);

  return { from, to };
}

export default async function CalendarPage({
  searchParams,
}: CalendarPageProps) {
  await connection();

  const { date } = await searchParams;
  const [{ items }, coworkers] = await Promise.all([
    taskService.getWorkspaceCalendar({ ...getCalendarRange(date), limit: 100 }),
    coworkerService.listCoworkers().catch(() => []),
  ]);

  return (
    <div className="w-full px-2">
      <WorkspaceCalendar
        items={items}
        coworkers={coworkers.map((coworker) => ({
          id: coworker.id,
          name: coworker.name,
        }))}
      />
    </div>
  );
}
