import { CalendarCreateTaskModal } from "@/app/calendar/components/calendar-create-task-modal";
import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import {
  type CalendarPageSearchParams,
  loadWorkspaceCalendarPage,
} from "@/app/calendar/load-calendar-page";
import { SocialCalendarPreviewProvider } from "@/app/social/components/social-calendar-preview";

/**
 * Workspace calendar embedded as the Tasks "Calendar" tab.
 * Relies on TasksView's CreateTaskModalProvider — do not wrap another.
 */
export async function TasksCalendarPanel({
  searchParams,
}: {
  searchParams: Promise<CalendarPageSearchParams>;
}) {
  const page = await loadWorkspaceCalendarPage({ searchParams });

  return (
    <>
      <SocialCalendarPreviewProvider>
        <WorkspaceCalendar
          activeOrganizationId={page.activeOrganizationId}
          currentUserId={page.currentUserId}
          workspaceId={page.workspaceId}
          includeSocialPosts={page.includeSocialPosts}
          key={page.calendarKey}
          initialDate={page.initialDate}
          items={page.items}
          latestDate={page.latestDate}
          sources={page.sources}
          pagination={page.pagination}
          range={page.range}
          coworkers={page.coworkerOptions}
        />
      </SocialCalendarPreviewProvider>
      <CalendarCreateTaskModal
        coworkerOptions={page.coworkerOptions}
        projectOptions={page.projectOptions}
      />
    </>
  );
}
