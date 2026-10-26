import type { SocialPost } from "@sokosumi/core-client";
import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
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
  let project = null;
  let projectLoadFailed = false;
  if (projectId) {
    try {
      project = await projectService.getProjectById(projectId);
    } catch {
      projectLoadFailed = true;
    }
  }

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
            notice={
              projectId && !projectLoadFailed ? t("pickUnavailable") : undefined
            }
            projectFailed={projectLoadFailed}
            workspaceId={calendar.workspaceId}
          />
        </SocialCalendarPreviewProvider>
      </SocialPageShell>
    );
  }

  const [
    pages,
    connectionsResult,
    selectedPostResult,
    calendarResult,
    sokoBot,
    queueSlots,
  ] = await Promise.all([
    Promise.all(
      SECTION_ORDER.map(async (section) => {
        try {
          return {
            failed: false as const,
            ...(await projectService.listSocialPosts(project.id, {
              statuses: SECTION_STATUSES[section],
            })),
          };
        } catch {
          return {
            failed: true as const,
            posts: [],
            nextCursor: null,
          };
        }
      }),
    ),
    projectService
      .listSocialConnections(project.id)
      .then((connections) => ({ failed: false as const, connections }))
      .catch(() => ({ failed: true as const, connections: [] })),
    query.postId
      ? projectService
          .getSocialPost(project.id, query.postId)
          .then((post) => ({ failed: false as const, post }))
          .catch(() => ({ failed: true as const, post: null }))
      : Promise.resolve({ failed: false as const, post: null }),
    loadWorkspaceCalendarPage({
      projectId: project.id,
      searchParams: Promise.resolve(withoutAgendaView(query)),
    })
      .then((calendar) => ({ failed: false as const, calendar }))
      .catch((error: unknown) => {
        unstable_rethrow(error);
        return { failed: true as const, calendar: null };
      }),
    sokoBotService.getMine().catch(() => null),
    projectService.listSocialQueueSlots(project.id).catch(() => null),
  ]);
  const { connections, failed: accountsFailed } = connectionsResult;
  const { calendar, failed: calendarFailed } = calendarResult;
  const { post: selectedPost, failed: selectedPostFailed } = selectedPostResult;
  // Count every affected scheduled/failed post, including later list pages.
  // A failed read here only shortens the reconnect counts; Social stays up.
  const affectedPosts: SocialPost[] = [...pages[1].posts];
  try {
    const scheduledPage = await projectService.listSocialPosts(project.id, {
      statuses: ["SCHEDULED"],
    });
    affectedPosts.push(...scheduledPage.posts);
    for (const [statuses, initialCursor] of [
      [SECTION_STATUSES.attention, pages[1].nextCursor],
      [["SCHEDULED"], scheduledPage.nextCursor],
    ] as const) {
      let cursor = initialCursor;
      while (cursor) {
        const page = await projectService.listSocialPosts(project.id, {
          statuses,
          cursor,
        });
        affectedPosts.push(...page.posts);
        cursor = page.nextCursor;
      }
    }
  } catch {
    // Keep the posts already read.
  }
  const activeConnections = connections.filter(
    (socialConnection) => socialConnection.status === "active",
  );
  const managedAccountCount = connections.filter(
    (socialConnection) => socialConnection.status !== "disconnected",
  ).length;
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
            connectDisabled={Boolean(project.closingAt || project.closedAt)}
            accounts={
              <ProjectSocialAccounts
                projectId={project.id}
                connections={connections}
                queueSlots={queueSlots ?? undefined}
                connectDisabled={Boolean(project.closingAt || project.closedAt)}
              />
            }
            actions={
              <SocialNewPostMenu
                project={{ id: project.id, name: project.name }}
                sokoBotId={sokoBot?.id ?? null}
              />
            }
            calendar={
              calendar ? (
                <SocialCalendar
                  calendar={calendar}
                  lockedProjectId={project.id}
                />
              ) : undefined
            }
            accountCount={managedAccountCount}
            managedConnections={connections}
            affectedPosts={affectedPosts}
            accountsFailed={accountsFailed || queueSlots === null}
            calendarFailed={calendarFailed}
            connections={activeConnections}
            failedSections={SECTION_ORDER.filter(
              (_, index) => pages[index].failed,
            )}
            nextCursors={Object.fromEntries(
              SECTION_ORDER.map((section, index) => [
                section,
                pages[index].nextCursor,
              ]),
            )}
            queueSlots={queueSlots?.slots}
            posts={posts}
            projectId={project.id}
            requestedPostId={query.postId}
            selectedPostFailed={selectedPostFailed}
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
