import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import {
  type CalendarPageSearchParams,
  loadWorkspaceCalendarPage,
} from "@/app/calendar/load-calendar-page";
import { ProjectSocialAccounts } from "@/app/projects/components/project-social-accounts";
import {
  SECTION_ORDER,
  SECTION_STATUSES,
} from "@/app/projects/components/social-posts/constants";
import { ProjectSocialPosts } from "@/app/projects/components/social-posts/project-social-posts";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";

import { SocialPageShell } from "./components/social-page-shell";
import { SocialProjectPicker } from "./components/social-project-picker";

// Wait for the current session and project access before rendering.
export const instant = false;

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
 * projects without Social knowing anything about the switcher. Before this it
 * was a tab inside one project, which made the reader leave the surface to
 * plan the next project's posts.
 */
export default async function SocialPage({ searchParams }: SocialPageProps) {
  await connection();
  if (!(await hasCurrentUserSocialBetaAccess())) {
    notFound();
  }

  const query = await searchParams;
  const t = await getTranslations("App.Social");
  const projectId = query.projectId?.trim();

  if (!projectId) {
    return (
      <SocialPageShell title={t("title")}>
        <SocialProjectPicker />
      </SocialPageShell>
    );
  }

  const project = await projectService.getProjectById(projectId);
  // Not `notFound()`: the id came from a switchable scope, not from the path,
  // so the repair is to pick another project rather than to leave the page.
  if (!project) {
    return (
      <SocialPageShell title={t("title")}>
        <SocialProjectPicker notice={t("pickUnavailable")} />
      </SocialPageShell>
    );
  }

  const [pages, connections, selectedPost, calendar] = await Promise.all([
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
    loadWorkspaceCalendarPage({ projectId: project.id, searchParams }),
  ]);
  const activeConnections = connections.filter(
    (socialConnection) =>
      socialConnection.status === "active" && socialConnection.provider === "x",
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
      <div className="space-y-8">
        <section
          aria-labelledby="social-calendar-heading"
          className="space-y-2"
        >
          <div className="space-y-1">
            <h2
              className="text-base font-semibold"
              id="social-calendar-heading"
            >
              {t("calendar.title")}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t("calendar.description")}
            </p>
          </div>
          <WorkspaceCalendar
            activeOrganizationId={calendar.activeOrganizationId}
            coworkers={calendar.coworkerOptions}
            currentUserId={calendar.currentUserId}
            includeSocialPosts={calendar.includeSocialPosts}
            initialDate={calendar.initialDate}
            items={calendar.items}
            key={calendar.calendarKey}
            latestDate={calendar.latestDate}
            lockedProjectId={project.id}
            pagination={calendar.pagination}
            range={calendar.range}
            // Nothing but Social posts belongs on Social's own calendar, so the
            // task runs of the same project are left out here rather than
            // behind a toggle the reader would have to find.
            socialPostsOnly
            sources={calendar.sources}
            workspaceId={project.workspaceId}
          />
        </section>

        <ProjectSocialPosts
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
        <ProjectSocialAccounts
          projectId={project.id}
          connections={connections}
        />
      </div>
    </SocialPageShell>
  );
}
