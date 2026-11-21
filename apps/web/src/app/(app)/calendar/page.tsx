import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CalendarCreateTaskModal } from "@/app/calendar/components/calendar-create-task-modal";
import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import { SocialCalendarPreviewProvider } from "@/app/social/components/social-calendar-preview";
import { CreateTaskModalProvider } from "@/app/tasks/components/create-task-modal";
import { PageQuerySearchField } from "@/components/page-query-search-field";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";
import { rankPageItems } from "@/lib/utils/page-search";
import { calendarSearchFields } from "./calendar-search";
import { calendarUrl } from "./calendar-url";
import {
  type CalendarPageSearchParams,
  loadWorkspaceCalendarPage,
} from "./load-calendar-page";

// Wait for the current session and project access before rendering.
export const instant = false;

interface CalendarPageProps {
  // `socialOnly` is the retired "Social posts only" switch, still in old links.
  searchParams: Promise<
    CalendarPageSearchParams & { socialOnly?: string; q?: string }
  >;
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
  const { q, ...params } = await searchParams;
  const term = typeof q === "string" ? q.trim() : "";
  if (params.socialOnly !== undefined) redirect(calendarUrl(params));

  const page = await loadWorkspaceCalendarPage({
    complete: Boolean(term),
    searchParams: Promise.resolve(params),
  });

  const items = rankPageItems(page.items, term, (entry) =>
    calendarSearchFields(entry, page),
  );
  const empty = Boolean(term) && !items.length;
  const tSearch = await getTranslations("App.PageSearch");

  return (
    <CreateTaskModalProvider>
      <RefreshPrefetchedPage />
      {empty ? (
        <p role="status" className="text-muted-foreground mb-3 text-sm">
          {tSearch("noMatches")}
        </p>
      ) : null}
      <SocialCalendarPreviewProvider>
        <WorkspaceCalendar
          searchField={
            <PageQuerySearchField inHeader placeholder={tSearch("calendar")} />
          }
          activeOrganizationId={page.activeOrganizationId}
          coworkers={page.coworkerOptions}
          currentUserId={page.currentUserId}
          initialDate={page.initialDate}
          items={items}
          calendarKey={page.calendarKey}
          latestDate={page.latestDate}
          newsletterEnabled={page.newsletterEnabled}
          pagination={page.pagination}
          range={page.range}
          renderedTimezone={page.renderedTimezone}
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
