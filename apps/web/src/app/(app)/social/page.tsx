import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import {
  type CalendarPageSearchParams,
  type LoadedWorkspaceCalendarPage,
  loadWorkspaceCalendarPage,
} from "@/app/calendar/load-calendar-page";
import { ProjectSocialAccounts } from "@/app/projects/components/project-social-accounts";
import {
  SECTION_ORDER,
  SECTION_STATUSES,
} from "@/app/projects/components/social-posts/constants";
import { ProjectSocialPosts } from "@/app/projects/components/social-posts/project-social-posts";
import { projectService } from "@/lib/services/project.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";

import { SocialAllProjectsTabs } from "./components/social-all-projects-tabs";
import { SocialCalendarPreviewProvider } from "./components/social-calendar-preview";
import { SocialComposeProvider } from "./components/social-compose-context";
import { SocialNewPostMenu } from "./components/social-new-post-menu";
import { SocialPageShell } from "./components/social-page-shell";

// Wait for the current session and project access before rendering.
export const instant = false;

/**
 * Social's calendar has no agenda list, but older links (and the workspace
 * calendar's phone default) can still carry `view=agenda`; loading that
 * range would leave the month grid missing posts.
 */
function withoutAgendaView<T extends { view?: string }>(query: T): T {
  return query.view === "agenda" ? { ...query, view: undefined } : query;
}

interface SocialPageProps {
  searchParams: Promise<CalendarPageSearchParams & { postId?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Social");
  return { title: t("title") };
}

/**
 * Social posts, as a top-level destination.
 *
 * It reads its project from `?projectId=`, the same scope Tasks, Calendar and
 * the studio read, so the sidebar's project switcher moves Social between
 * projects without Social knowing anything about the switcher. With no
 * project it is still a page: the posting schedule of every project, with a
 * note that accounts are connected per project.
 */
export default async function SocialPage({ searchParams }: SocialPageProps) {
  await connection();
  if (!(await hasCurrentUserSocialBetaAccess())) {
    notFound();
  }

  const query = await searchParams;
  const t = await getTranslations("App.Social");
  const projectId = query.projectId?.trim();
  const project = projectId
    ? await projectService.getProjectById(projectId)
    : null;

  if (!project) {
    const [calendar, sokoBot] = await Promise.all([
      // Drop an id the workspace no longer has, or the calendar would filter
      // to a project that is not there.
      loadWorkspaceCalendarPage({
        searchParams: Promise.resolve({
          ...withoutAgendaView(query),
          projectId: undefined,
        }),
      }),
      sokoBotService.getMine().catch(() => null),
    ]);
    return (
      <SocialPageShell title={t("title")}>
        <SocialCalendarPreviewProvider>
          <SocialAllProjectsTabs
            actions={
              <SocialNewPostMenu
                project={null}
                sokoBotId={sokoBot?.id ?? null}
              />
            }
            calendar={<SocialCalendar calendar={calendar} />}
            notice={projectId ? t("pickUnavailable") : undefined}
          />
        </SocialCalendarPreviewProvider>
      </SocialPageShell>
    );
  }

  const [pages, connections, selectedPost, calendar, sokoBot] =
    await Promise.all([
      Promise.all(
        SECTION_ORDER.map((section) =>
          projectService.listSocialPosts(project.id, {
            statuses: SECTION_STATUSES[section],
          }),
        ),
      ),
      projectService.listSocialConnections(project.id),
      query.postId
        ? projectService.getSocialPost(project.id, query.postId)
        : Promise.resolve(null),
      loadWorkspaceCalendarPage({
        projectId: project.id,
        searchParams: Promise.resolve(withoutAgendaView(query)),
      }),
      sokoBotService.getMine().catch(() => null),
    ]);
  const activeConnections = connections.filter(
    (socialConnection) => socialConnection.status === "active",
  );
  const posts = selectedPost
    ? [
        selectedPost,
        ...pages
          .flatMap((page) => page.posts)
          .filter((post) => post.id !== selectedPost.id),
      ]
    : pages.flatMap((page) => page.posts);

  return (
    <SocialPageShell title={t("title")}>
      <SocialCalendarPreviewProvider>
        <SocialComposeProvider>
          <ProjectSocialPosts
            accounts={
              <ProjectSocialAccounts
                projectId={project.id}
                connections={connections}
              />
            }
            actions={
              <SocialNewPostMenu
                project={{ id: project.id, name: project.name }}
                sokoBotId={sokoBot?.id ?? null}
              />
            }
            calendar={
              <SocialCalendar
                calendar={calendar}
                lockedProjectId={project.id}
              />
            }
            connections={activeConnections}
            nextCursors={Object.fromEntries(
              SECTION_ORDER.map((section, index) => [
                section,
                pages[index].nextCursor,
              ]),
            )}
            posts={posts}
            projectId={project.id}
            selectedPostId={selectedPost?.id}
          />
        </SocialComposeProvider>
      </SocialCalendarPreviewProvider>
    </SocialPageShell>
  );
}

function SocialCalendar({
  calendar,
  lockedProjectId,
}: {
  calendar: LoadedWorkspaceCalendarPage;
  lockedProjectId?: string;
}) {
  return (
    <WorkspaceCalendar
      activeOrganizationId={calendar.activeOrganizationId}
      coworkers={calendar.coworkerOptions}
      currentUserId={calendar.currentUserId}
      includeSocialPosts={calendar.includeSocialPosts}
      initialDate={calendar.initialDate}
      items={calendar.items}
      key={calendar.calendarKey}
      latestDate={calendar.latestDate}
      lockedProjectId={lockedProjectId}
      pagination={calendar.pagination}
      range={calendar.range}
      // Nothing but Social posts belongs on Social's own calendar, so task
      // runs are left out here rather than behind a toggle the reader would
      // have to find.
      socialPostsOnly
      sources={calendar.sources}
      workspaceId={calendar.workspaceId}
    />
  );
}
