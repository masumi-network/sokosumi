import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CalendarCreateTaskModal } from "@/app/calendar/components/calendar-create-task-modal";
import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import { SocialCalendarPreviewProvider } from "@/app/social/components/social-calendar-preview";
import { CreateTaskModalProvider } from "@/app/tasks/components/create-task-modal";
import { calendarUrl } from "./calendar-url";
import {
  type CalendarPageSearchParams,
  loadWorkspaceCalendarPage,
} from "./load-calendar-page";

// Wait for the current session and project access before rendering.
export const instant = false;

interface CalendarPageProps {
  // `socialOnly` is the retired "Social posts only" switch, still in old links.
  searchParams: Promise<CalendarPageSearchParams & { socialOnly?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Calendar.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

/**
 * Everything with a date, one feature per filter. It reads its project from
 * `?projectId=`, the scope the sidebar's project switcher sets.
 */
export default async function CalendarPage({
  searchParams,
}: CalendarPageProps) {
  const params = await searchParams;
  if (params.socialOnly !== undefined) redirect(calendarUrl(params));

  const page = await loadWorkspaceCalendarPage({
    searchParams: Promise.resolve(params),
  });

  return (
    <CreateTaskModalProvider>
      <SocialCalendarPreviewProvider>
        <WorkspaceCalendar
          activeOrganizationId={page.activeOrganizationId}
          coworkers={page.coworkerOptions}
          currentUserId={page.currentUserId}
          initialDate={page.initialDate}
          items={page.items}
          key={page.calendarKey}
          latestDate={page.latestDate}
          newsletterEnabled={page.newsletterEnabled}
          pagination={page.pagination}
          range={page.range}
          sources={page.sources}
          workspaceId={page.workspaceId}
        />
      </SocialCalendarPreviewProvider>
      <CalendarCreateTaskModal
        coworkerOptions={page.coworkerOptions}
        projectOptions={page.projectOptions}
      />
    </CreateTaskModalProvider>
  );
}
