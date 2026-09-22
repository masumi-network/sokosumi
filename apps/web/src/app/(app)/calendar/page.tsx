import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CalendarCreateTaskModal } from "@/app/calendar/components/calendar-create-task-modal";
import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import {
  type CalendarPageSearchParams,
  loadWorkspaceCalendarPage,
} from "@/app/calendar/load-calendar-page";
import { CreateTaskModalProvider } from "@/app/tasks/components/create-task-modal";

interface CalendarPageProps {
  searchParams: Promise<CalendarPageSearchParams>;
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
  const page = await loadWorkspaceCalendarPage({ searchParams });

  return (
    <CreateTaskModalProvider>
      <div className="w-full">
        <WorkspaceCalendar
          activeOrganizationId={page.activeOrganizationId}
          currentUserId={page.currentUserId}
          workspaceId={page.workspaceId}
          key={page.calendarKey}
          initialDate={page.initialDate}
          items={page.items}
          latestDate={page.latestDate}
          sources={page.sources}
          pagination={page.pagination}
          range={page.range}
          coworkers={page.coworkerOptions}
        />
        <CalendarCreateTaskModal
          coworkerOptions={page.coworkerOptions}
          projectOptions={page.projectOptions}
        />
      </div>
    </CreateTaskModalProvider>
  );
}
