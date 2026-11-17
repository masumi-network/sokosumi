import "server-only";

import type { SocialPost } from "@sokosumi/core-client";
import type { Session } from "@sokosumi/utils";
import { cacheLife } from "next/cache";
import { notFound, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";

import type { CalendarType } from "@/app/calendar/calendar-types";
import {
  type CalendarPageSearchParams,
  readWorkspaceCalendarPage,
  requestCalendarTimezone,
} from "@/app/calendar/load-calendar-page";
import {
  SECTION_ORDER,
  SECTION_STATUSES,
} from "@/app/projects/components/social-posts/constants";
import { getSession, getSessionResult } from "@/lib/auth/auth.server";
import { CoreAuthUnavailableError } from "@/lib/auth/errors";
import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { projectService } from "@/lib/services/project.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";

/**
 * All projects' Needs attention: what a project lists there (failed and
 * missed) plus posts waiting for someone's approval.
 */
const ALL_PROJECTS_ATTENTION_STATUSES = [
  ...SECTION_STATUSES.attention,
  "NEEDS_APPROVAL",
] as const;

/** Social's calendar shows Social posts and asks Core for nothing else. */
export const SOCIAL_CALENDAR_TYPES: readonly CalendarType[] = ["social"];

/**
 * Social's calendar has no agenda list, but older links (and the workspace
 * calendar's phone default) can still carry `view=agenda`; loading that
 * range would leave the month grid missing posts. Task filters would also
 * hide Social posts on the Core read, so drop them here.
 */
function socialCalendarQuery(query: CalendarPageSearchParams) {
  return {
    ...query,
    assigneeId: undefined,
    assigneeUserId: undefined,
    // Older links may still carry a Tasks source filter; Social has none.
    sourceId: undefined,
    status: undefined,
    view: query.view === "agenda" ? undefined : query.view,
  };
}

export type SocialPageQuery = CalendarPageSearchParams & { postId?: string };

interface SocialPageDataInput {
  query: SocialPageQuery;
  /** The calendar's zone, resolved from the request. */
  timezone: string;
}

async function readWorkspaceSocialPage(
  { query, timezone }: SocialPageDataInput,
  session: Session | null,
  projectLoadFailed: boolean,
) {
  const [calendar, sokoBot, attention] = await Promise.all([
    // Drop an id the workspace no longer has, or the calendar would filter
    // to a project that is not there.
    readWorkspaceCalendarPage(
      {
        requested: { ...socialCalendarQuery(query), projectId: undefined },
        types: SOCIAL_CALENDAR_TYPES,
        timezone,
      },
      session,
    ),
    sokoBotService.getMine().catch(() => null),
    projectService
      .listWorkspaceSocialPosts(ALL_PROJECTS_ATTENTION_STATUSES)
      .catch(() => null),
  ]);
  // Without a route Project the calendar always has a page.
  if (!calendar) throw new Error("Social calendar unavailable");
  return {
    kind: "workspace" as const,
    projectLoadFailed,
    calendar,
    sokoBot,
    attention,
  };
}

async function readProjectSocialPage(
  { query, timezone }: SocialPageDataInput,
  session: Session | null,
  projectId: string,
) {
  const [
    pages,
    connectionsResult,
    selectedPostResult,
    calendarResult,
    sokoBot,
    queueResult,
  ] = await Promise.all([
    Promise.all(
      SECTION_ORDER.map(async (section) => {
        try {
          return {
            failed: false as const,
            ...(await projectService.listSocialPosts(projectId, {
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
      .listSocialConnections(projectId)
      .then((connections) => ({ failed: false as const, connections }))
      .catch(() => ({ failed: true as const, connections: [] })),
    query.postId
      ? projectService
          .getSocialPost(projectId, query.postId)
          .then((post) => ({ failed: false as const, post }))
          .catch(() => ({ failed: true as const, post: null }))
      : Promise.resolve({ failed: false as const, post: null }),
    readWorkspaceCalendarPage(
      {
        projectId,
        requested: socialCalendarQuery(query),
        types: SOCIAL_CALENDAR_TYPES,
        timezone,
      },
      session,
    )
      .then((calendar) => ({ failed: false as const, calendar }))
      .catch((error: unknown) => {
        unstable_rethrow(error);
        return { failed: true as const, calendar: null };
      }),
    sokoBotService.getMine().catch(() => null),
    projectService
      .listSocialQueueSlots(projectId)
      .then((queueSlots) => ({ failed: false as const, queueSlots }))
      .catch(() => ({ failed: true as const, queueSlots: null })),
  ]);
  // Count every affected scheduled/failed post, including later list pages.
  // A failed read here only shortens the reconnect counts; Social stays up.
  const affectedPosts: SocialPost[] = [...pages[1].posts];
  try {
    const scheduledPage = await projectService.listSocialPosts(projectId, {
      statuses: ["SCHEDULED"],
    });
    affectedPosts.push(...scheduledPage.posts);
    for (const [statuses, initialCursor] of [
      [SECTION_STATUSES.attention, pages[1].nextCursor],
      [["SCHEDULED"], scheduledPage.nextCursor],
    ] as const) {
      let cursor = initialCursor;
      while (cursor) {
        const page = await projectService.listSocialPosts(projectId, {
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
  return {
    pages,
    connectionsResult,
    selectedPostResult,
    calendarResult,
    sokoBot,
    queueResult,
    affectedPosts,
  };
}

async function readSocialPageData(
  input: SocialPageDataInput,
  session: Session | null,
) {
  const projectId = input.query.projectId?.trim();
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
    return readWorkspaceSocialPage(input, session, projectLoadFailed);
  }
  const data = await readProjectSocialPage(input, session, project.id);
  // The calendar lost the Project between the two reads: the caller 404s.
  if (!data.calendarResult.failed && !data.calendarResult.calendar) {
    return null;
  }
  return { kind: "project" as const, project, ...data };
}

type SocialPageData = Awaited<ReturnType<typeof readSocialPageData>>;

async function readPrivateCachedSocialPageData(
  input: SocialPageDataInput,
): Promise<SocialPageData> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  const sessionResult = await getSessionResult();
  // Thrown, never cached: an outage must not be kept as "signed out".
  if (sessionResult.isErr()) {
    throw new CoreAuthUnavailableError(sessionResult.error.reason);
  }
  return readSocialPageData(input, sessionResult.value);
}

/**
 * The Social page's Core reads, cached for the browser only, so a link
 * prefetch carries the page. A read that throws is never kept: the page then
 * renders fresh on the click, with the same reads uncached. A failure a read
 * turns into a fallback value, such as a failed project or section list, is
 * kept for the stale window until the refresh on mount replaces it.
 */
export async function loadSocialPageData(query: SocialPageQuery) {
  const input: SocialPageDataInput = {
    query,
    timezone: await requestCalendarTimezone(query),
  };
  const data = await readPrivateCachedSocialPageData(input).catch(
    async (error: unknown) => {
      unstable_rethrow(error);
      await connection();
      return readSocialPageData(input, await getSession());
    },
  );
  if (!data) notFound();
  return data;
}
