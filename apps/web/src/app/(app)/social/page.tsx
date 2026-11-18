import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import type { LoadedWorkspaceCalendarPage } from "@/app/calendar/load-calendar-page";
import { ProjectPostingInstructions } from "@/app/projects/components/project-posting-instructions";
import { ProjectSocialAccounts } from "@/app/projects/components/project-social-accounts";
import { SECTION_ORDER } from "@/app/projects/components/social-posts/constants";
import { ProjectSocialPosts } from "@/app/projects/components/social-posts/project-social-posts";
import { SocialLoadError } from "@/app/projects/components/social-posts/social-load-error";
import { CmoProjectBanner } from "@/components/cmo-project-banner";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";

import { SocialAllProjectsAttention } from "./components/social-all-projects-attention";
import { SocialAllProjectsTabs } from "./components/social-all-projects-tabs";
import { SocialCalendarPreviewProvider } from "./components/social-calendar-preview";
import { SocialComposeProvider } from "./components/social-compose-context";
import { SocialNewPostMenu } from "./components/social-new-post-menu";
import { SocialPageShell } from "./components/social-page-shell";
import {
  loadSocialPageData,
  SOCIAL_CALENDAR_TYPES,
  type SocialPageQuery,
} from "./social-page-data";

// Wait for the current session and project access before rendering.
export const instant = false;

interface SocialPageProps {
  searchParams: Promise<SocialPageQuery>;
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
  const query = await searchParams;
  const [t, data] = await Promise.all([
    getTranslations("App.Social"),
    loadSocialPageData(query),
  ]);
  const projectId = query.projectId?.trim();

  if (data.kind === "workspace") {
    const { calendar, sokoBot, attention, projectLoadFailed } = data;
    return (
      <SocialPageShell title={t("title")}>
        <RefreshPrefetchedPage />
        <SocialCalendarPreviewProvider>
          <SocialComposeProvider>
            <SocialAllProjectsTabs
              actions={
                <SocialNewPostMenu
                  project={null}
                  sokoBotId={sokoBot?.id ?? null}
                />
              }
              attention={
                attention ? (
                  <SocialAllProjectsAttention
                    hasMore={attention.hasMore}
                    items={attention.items}
                  />
                ) : (
                  <SocialLoadError kind="attention" />
                )
              }
              attentionCount={
                attention?.items.length
                  ? `${attention.items.length}${attention.hasMore ? "+" : ""}`
                  : undefined
              }
              calendar={<SocialCalendar calendar={calendar} />}
              notice={
                projectId && !projectLoadFailed
                  ? t("pickUnavailable")
                  : undefined
              }
              projectFailed={projectLoadFailed}
              workspaceId={calendar.workspaceId}
            />
          </SocialComposeProvider>
        </SocialCalendarPreviewProvider>
      </SocialPageShell>
    );
  }

  const {
    project,
    pages,
    connectionsResult,
    selectedPostResult,
    calendarResult,
    sokoBot,
    queueResult,
    affectedPosts,
  } = data;
  const { connections, failed: accountsFailed } = connectionsResult;
  const { calendar, failed: calendarFailed } = calendarResult;
  const { post: selectedPost, failed: selectedPostFailed } = selectedPostResult;
  // Null queue slots without a failure: the posting queue is not open to this user.
  const { queueSlots, failed: queueFailed } = queueResult;
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
      <RefreshPrefetchedPage />
      {project.cmo ? (
        <CmoProjectBanner className="mb-4" projectId={project.id} />
      ) : null}
      <SocialCalendarPreviewProvider>
        <SocialComposeProvider>
          <ProjectSocialPosts
            readOnly={project.cmo}
            connectDisabled={Boolean(project.closingAt || project.closedAt)}
            accounts={
              <div className="space-y-6">
                <ProjectSocialAccounts
                  projectId={project.id}
                  connections={connections}
                  readOnly={project.cmo}
                  queueSlots={queueSlots ?? undefined}
                  connectDisabled={Boolean(
                    project.closingAt || project.closedAt,
                  )}
                />
                <ProjectPostingInstructions
                  projectId={project.id}
                  postingInstructionsMd={project.postingInstructionsMd}
                  disabled={Boolean(
                    project.cmo || project.closingAt || project.closedAt,
                  )}
                />
              </div>
            }
            actions={
              project.cmo ? undefined : (
                <SocialNewPostMenu
                  project={{ id: project.id, name: project.name }}
                  sokoBotId={sokoBot?.id ?? null}
                />
              )
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
            accountsFailed={accountsFailed || queueFailed}
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
      initialDate={calendar.initialDate}
      items={calendar.items}
      key={calendar.calendarKey}
      latestDate={calendar.latestDate}
      lockedProjectId={lockedProjectId}
      pagination={calendar.pagination}
      range={calendar.range}
      renderedTimezone={calendar.renderedTimezone}
      sources={calendar.sources}
      // Nothing but Social posts belongs on Social's own calendar, so the
      // other features are left out here rather than behind a filter the
      // reader would have to find.
      types={SOCIAL_CALENDAR_TYPES}
      workspaceId={calendar.workspaceId}
    />
  );
}
