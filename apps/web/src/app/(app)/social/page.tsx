import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { calendarSearchFields } from "@/app/calendar/calendar-search";
import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import type { LoadedWorkspaceCalendarPage } from "@/app/calendar/load-calendar-page";
import { ProjectPostingInstructions } from "@/app/projects/components/project-posting-instructions";
import { ProjectSocialAccounts } from "@/app/projects/components/project-social-accounts";
import { SECTION_ORDER } from "@/app/projects/components/social-posts/constants";
import { ProjectSocialPosts } from "@/app/projects/components/social-posts/project-social-posts";
import { SocialLoadError } from "@/app/projects/components/social-posts/social-load-error";
import {
  searchSocialPosts,
  socialPostSearchFields,
} from "@/app/projects/components/social-posts/social-post-list";
import { CmoProjectBanner } from "@/components/cmo-project-banner";
import { PageQuerySearchField } from "@/components/page-query-search-field";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";
import { SearchablePageContent } from "@/components/searchable-page-content";
import { rankPageItems } from "@/lib/utils/page-search";

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
  const [t, tSearch, data] = await Promise.all([
    getTranslations("App.Social"),
    getTranslations("App.PageSearch"),
    loadSocialPageData(query),
  ]);
  const projectId = query.projectId?.trim();
  const term = typeof query.q === "string" ? query.q.trim() : "";
  const showCalendar = !data.searchTab || data.searchTab === "calendar";
  const field = (
    <PageQuerySearchField
      className="mb-3 w-full sm:w-64"
      placeholder={tSearch("posts")}
    />
  );

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
                <>
                  {field}
                  {attention ? (
                    <SocialAllProjectsAttention
                      query={term}
                      hasMore={attention.hasMore}
                      items={
                        term
                          ? data.searchTab === "attention"
                            ? rankPageItems(
                                attention.items,
                                term,
                                ({ post, projectName }) =>
                                  socialPostSearchFields(post, projectName),
                              )
                            : []
                          : attention.items
                      }
                    />
                  ) : (
                    <SocialLoadError kind="attention" />
                  )}
                </>
              }
              attentionCount={
                attention?.items.length
                  ? `${attention.items.length}${attention.hasMore ? "+" : ""}`
                  : undefined
              }
              calendar={
                <>
                  {field}
                  {showCalendar && (
                    <SocialCalendar calendar={calendar} query={term} />
                  )}
                </>
              }
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
  const listedPosts = term
    ? pages.flatMap((page, index) =>
        SECTION_ORDER[index] === data.searchTab
          ? searchSocialPosts(page.posts, term)
          : [],
      )
    : pages.flatMap((page) => page.posts);
  const posts = selectedPost
    ? [
        selectedPost,
        ...listedPosts.filter((post) => post.id !== selectedPost.id),
      ]
    : listedPosts;

  return (
    <SocialPageShell title={t("title")}>
      <RefreshPrefetchedPage />
      {project.cmo ? (
        <CmoProjectBanner className="mb-4" projectId={project.id} />
      ) : null}
      <SocialCalendarPreviewProvider>
        <SocialComposeProvider>
          <ProjectSocialPosts
            searchField={field}
            searchQuery={term}
            sectionCounts={
              term
                ? {
                    drafts: pages[0].posts.length,
                    attention: pages[1].posts.length,
                  }
                : undefined
            }
            readOnly={project.cmo}
            connectDisabled={Boolean(project.closingAt || project.closedAt)}
            accounts={
              <SearchablePageContent>
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
              </SearchablePageContent>
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
                <>
                  {field}
                  {showCalendar && (
                    <SocialCalendar
                      calendar={calendar}
                      lockedProjectId={project.id}
                      query={term}
                    />
                  )}
                </>
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
  query,
  lockedProjectId,
}: {
  calendar: LoadedWorkspaceCalendarPage;
  query: string;
  lockedProjectId?: string;
}) {
  return (
    <WorkspaceCalendar
      activeOrganizationId={calendar.activeOrganizationId}
      coworkers={calendar.coworkerOptions}
      currentUserId={calendar.currentUserId}
      initialDate={calendar.initialDate}
      items={rankPageItems(calendar.items, query, (entry) =>
        calendarSearchFields(entry, calendar),
      )}
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
