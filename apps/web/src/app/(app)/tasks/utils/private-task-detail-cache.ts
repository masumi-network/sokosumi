import "server-only";

import type { Project, Task } from "@sokosumi/core-client";
import { TaskVisibility } from "@sokosumi/core-client";
import type { Session, SubscriptionPlanName } from "@sokosumi/utils";
import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { ViewerSokoBotFace } from "@/app/tasks/components/task-activity-subscribe";
import { resolveTaskDetailViewerPlan } from "@/app/tasks/utils/task-activity-plan";
import { listTaskAssigneeMemberOptions } from "@/app/tasks/utils/task-assignee-members";
import { botFaceSeed } from "@/components/soko-bot/bot-face";
import { getPrivateCachedSession } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { organizationSeatService } from "@/lib/services/organization-seat.service";
import { projectService } from "@/lib/services/project.service";

// The task detail page's Core reads, cached for the browser only. A task
// link's prefetch carries the page only when the reads it waits on are cached,
// so each read that gates the page or a visible section is cached here. The
// page refreshes itself after a client navigation, so this copy shows only
// until the fresh render arrives.

type MentionableMembers = Awaited<
  ReturnType<typeof listTaskAssigneeMemberOptions>
>;

/**
 * The task, or null when Core has none for this workspace. Any other failure
 * throws, so the browser never keeps a passing outage as "not found".
 */
export async function getPrivateCachedTask(
  taskId: string,
): Promise<Task | null> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  try {
    return (await coreClient.getTaskById(taskId)).data;
  } catch (error) {
    if (error instanceof CoreApiRequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function getPrivateCachedAssignedSeat(
  organizationId: string | null,
): Promise<boolean> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return organizationSeatService.hasAssignedSeat(organizationId);
}

async function getPrivateCachedProject(
  projectId: string,
): Promise<Project | null> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return projectService.getProjectById(projectId);
}

async function getPrivateCachedViewerPlan(
  forceReadOnly: boolean,
  session: Session | null,
  organizationId: string | null,
): Promise<SubscriptionPlanName | null> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return resolveTaskDetailViewerPlan(forceReadOnly, session, organizationId);
}

/** The face a read failure shows: the default Soko Bot orb. */
const UNKNOWN_SOKO_BOT_FACE: ViewerSokoBotFace = {
  imageUrl: null,
  avatarCode: null,
  seed: "soko-bot",
};

/**
 * The viewer's personal Soko Bot here, as a face; Core answers 404 for none.
 * The activity read, not the full state: it is one small indexed read.
 */
async function getPrivateCachedViewerSokoBot(): Promise<ViewerSokoBotFace | null> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  try {
    const { data: bot } = await coreClient.getMySokoBotActivity();
    // A Core that predates the face fields: a bot, with the default face.
    if (!bot.id) return UNKNOWN_SOKO_BOT_FACE;
    return {
      imageUrl: bot.avatarImageUrl,
      avatarCode: bot.avatarCode,
      seed: botFaceSeed(bot, bot.userId),
    };
  } catch (error) {
    if (error instanceof CoreApiRequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function getPrivateCachedMentionableMembers(
  organizationId: string | null,
): Promise<MentionableMembers> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return listTaskAssigneeMemberOptions(organizationId);
}

/**
 * Starts the private-cached reads that gate the task detail sections. Each is
 * a promise, so the view hands it to the section that awaits it and the other
 * sections render without waiting.
 *
 * A failed seat or plan read degrades (no seat, plan unavailable) instead of
 * rejecting. A hover prefetch would otherwise keep that failure as the error
 * page the click opens, which the refresh cannot reach. The fallback stays
 * outside the cache, so it is never kept, and the refresh replaces it.
 */
export function startPrivateTaskDetailReads(
  task: Task,
  forceReadOnly: boolean,
) {
  const organizationId = task.workspace.organizationId ?? null;
  const sessionPromise = getPrivateCachedSession();
  return {
    sessionPromise,
    // Admin read-only: plan is unavailable for the viewer (not "free"). Skip the
    // org subscription call that used to 403 → auth-redirect bounce.
    currentPlanPromise: sessionPromise
      .then((session) =>
        getPrivateCachedViewerPlan(forceReadOnly, session, task.organizationId),
      )
      .catch(() => null),
    hasAssignedSeatPromise: forceReadOnly
      ? Promise.resolve(false)
      : getPrivateCachedAssignedSeat(organizationId).catch((error: unknown) => {
          // A 401 from the seat read is a sign-in redirect, not an outage.
          unstable_rethrow(error);
          return false;
        }),
    mentionableUsersPromise:
      forceReadOnly || task.visibility === TaskVisibility.PRIVATE
        ? Promise.resolve<MentionableMembers>([])
        : getPrivateCachedMentionableMembers(organizationId),
    // Read-only views show no follow control.
    // Any failure but "no bot" offers to follow rather than sending the
    // viewer to setup; kept outside the cache, as above.
    viewerSokoBotPromise: forceReadOnly
      ? Promise.resolve(null)
      : getPrivateCachedViewerSokoBot().catch((error: unknown) => {
          unstable_rethrow(error);
          return UNKNOWN_SOKO_BOT_FACE;
        }),
    projectPromise: task.projectId
      ? getPrivateCachedProject(task.projectId).catch(() => null)
      : Promise.resolve(null),
  };
}
