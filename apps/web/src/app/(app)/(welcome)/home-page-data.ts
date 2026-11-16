import "server-only";

import type { Session } from "@sokosumi/utils";
import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";

import { WORKSPACE_COLUMN_ROWS } from "@/app/projects/constants";
import { getSession, getSessionResult } from "@/lib/auth/auth.server";
import { CoreAuthUnavailableError } from "@/lib/auth/errors";
import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { chatRoomService } from "@/lib/services/chat-room.service";
import { notificationService } from "@/lib/services/notification.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { taskService } from "@/lib/services/task.service";
import { userService } from "@/lib/services/user.service";

import { SOKO_BOT_HOME_TASK_LIMIT } from "./components/soko-bot-home-data";
import { SOKO_BOT_SETUP_FACES } from "./components/soko-bot-setup";

/**
 * Wraps a read in a browser-only cache, so a link prefetch carries Home. A
 * read that throws is never kept: the page then renders fresh on the click,
 * with the same read uncached. A failure a read turns into a fallback value,
 * such as a missing bot or an empty room list, is kept for the stale window
 * until the refresh on mount replaces it.
 */
function withFreshFallback<T>(
  privateCached: () => Promise<T>,
  uncached: () => Promise<T>,
): Promise<T> {
  return privateCached().catch(async (error: unknown) => {
    unstable_rethrow(error);
    await connection();
    return uncached();
  });
}

type WorkspaceAccess = Awaited<
  ReturnType<typeof userService.getWorkspaceAccess>
>;

async function readHomeGate(
  session: Session | null,
  readAccess: () => Promise<WorkspaceAccess>,
) {
  const [activeOrganizationId, access] = await Promise.all([
    userService.getActiveOrganizationId(),
    readAccess(),
  ]);
  return {
    userId: session?.user.id ?? null,
    userName: session?.user.name ?? null,
    activeOrganizationId,
    gate: access?.gate ?? null,
    // Read here, inside the cache: a clock read while the page renders for
    // a prefetch would stop that prefetch.
    now: new Date(),
  };
}

type HomeGate = Awaited<ReturnType<typeof readHomeGate>>;

async function readPrivateCachedHomeGate(): Promise<HomeGate> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  const sessionResult = await getSessionResult();
  // Thrown, never cached: an outage must not be kept as "signed out".
  if (sessionResult.isErr()) {
    throw new CoreAuthUnavailableError(sessionResult.error.reason);
  }
  // A failed access read throws here, so a Core blip is not kept as "not set
  // up": the click would redirect to setup with nothing to repair it.
  return readHomeGate(sessionResult.value, () =>
    userService.getWorkspaceAccess(),
  );
}

/**
 * Who reads Home, in which workspace, and whether it is set up. The app frame
 * reads the session and workspaces too, but its per-request cache does not
 * reach into this cache, so a render reads both once more.
 */
export function loadHomeGate(): Promise<HomeGate> {
  return withFreshFallback(readPrivateCachedHomeGate, async () =>
    readHomeGate(await getSession(), () =>
      userService.getWorkspaceAccess().catch(() => null),
    ),
  );
}

export type HomeScope = "workspace" | "owned";

async function readHomeData(scope: HomeScope) {
  // Each read needs the gate, not the bot, so each one starts before the bot
  // read answers instead of one Core round trip after it. Without a bot the
  // chats, team Tasks and Needs you go unused: the setup screen then waits on
  // them too. Accepted, so the bot read stays in the same round trip.
  //
  // The rooms are read only to find the bot's Direct. Outside this cache the
  // read shared the sidebar's per-request room list. React's per-request
  // cache does not reach into a "use cache" scope, so a fresh render now reads
  // the room list once more.
  const [
    needsYou,
    rooms,
    important,
    recentTasks,
    { sokoBot, lastFailure },
    summary,
  ] = await Promise.all([
    notificationService
      .readNeedsYou(WORKSPACE_COLUMN_ROWS)
      .catch((error: unknown) => {
        console.warn("Workspace column feed failed", { error });
        return null;
      }),
    chatRoomService
      .listRooms()
      .then(({ rooms }) => rooms)
      .catch(() => []),
    chatRoomService.listImportantMessages().catch(() => []),
    taskService
      .listTasks({
        scope,
        sort: "updatedAt",
        limit: SOKO_BOT_HOME_TASK_LIMIT * 2,
      })
      .then(({ tasks }) => tasks)
      .catch(() => []),
    sokoBotService
      .getMineWithLastFailure()
      .catch(() => ({ sokoBot: null, lastFailure: null })),
    // Window is session-derived in Core (`max(Session.updatedAt)`). No stamp.
    taskService.getActivitySummary({ scope }),
  ]);
  // Without pictures the page still offers the setup, only without the row.
  const avatars = sokoBot
    ? []
    : await sokoBotService
        .listAvatars(SOKO_BOT_SETUP_FACES, [])
        .catch(() => []);
  return {
    needsYou,
    rooms,
    important,
    recentTasks,
    sokoBot,
    lastFailure,
    summary,
    avatars,
  };
}

type HomeData = Awaited<ReturnType<typeof readHomeData>>;

async function readPrivateCachedHomeData(scope: HomeScope): Promise<HomeData> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return readHomeData(scope);
}

/**
 * Home's bot, chats, Tasks, summary and Needs you, for a workspace that is
 * set up. `scope` counts the whole workspace in an org and the reader's own
 * work in a personal one.
 */
export function loadHomeData(scope: HomeScope): Promise<HomeData> {
  return withFreshFallback(
    () => readPrivateCachedHomeData(scope),
    () => readHomeData(scope),
  );
}
