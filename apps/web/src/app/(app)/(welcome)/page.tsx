import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getNow, getTimeZone, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ChatLandingNotice } from "@/app/chat/components/chat-landing-notice";
import { ChatLanding } from "@/app/chat/components/landing/chat-landing";
import { ChatLandingMobile } from "@/app/chat/components/landing/chat-landing.mobile";
import { resolveLandingGreetingName } from "@/app/chat/components/landing/landing-content";
import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import {
  getPrivateCachedMembershipVisibleRooms,
  type PrivateChatListCacheArgs,
} from "@/app/components/private-sidebar-cache";
import {
  NeedsYouPanel,
  panelFeed,
} from "@/app/projects/components/workspace-column";
import {
  PROJECTS_PAGE_LIMIT,
  WORKSPACE_COLUMN_ROWS,
} from "@/app/projects/constants";
import { dayInTimeZone } from "@/app/tasks/utils/task-due";
import { getSession } from "@/lib/auth/auth.server";
import { chatRoomService } from "@/lib/services/chat-room.service";
import { coworkerService } from "@/lib/services/coworker.service";
import { notificationService } from "@/lib/services/notification.service";
import { projectService } from "@/lib/services/project.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { taskService } from "@/lib/services/task.service";
import { userService } from "@/lib/services/user.service";
import { isWorkspaceReady, WORKSPACE_GATE_PATH } from "@/lib/workspace-gate";

import { countOverdue, loadMyDay, MyDay } from "./components/my-day";
import { SokoBotHome } from "./components/soko-bot-home";
import {
  findSokoBotDirectRoom,
  SOKO_BOT_HOME_TASK_LIMIT,
  type SokoBotHomeChat,
  toImportantChats,
  toTeamDay,
} from "./components/soko-bot-home-data";

interface WelcomePageProps {
  searchParams: Promise<{
    notice?: string | string[];
  }>;
}

// Without its own title the landing page kept the layout's marketing line.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Metadata");
  return { title: t("home") };
}

/**
 * The bot's Direct (null when it has none yet or the read fails) and the
 * reader's important unread chat messages from the last day, which Core
 * picks from Jev's tags; the room list is the sidebar's cached one.
 */
async function loadSokoBotChats(
  sokoBotId: string,
  cacheArgs: PrivateChatListCacheArgs,
): Promise<{ roomId: string | null; chats: SokoBotHomeChat[] }> {
  const [{ rooms }, important, tChannels] = await Promise.all([
    // The sidebar's private-cache slice, so the load reads rooms from Core
    // once for both. It soft-fails to no rooms, as this read did.
    getPrivateCachedMembershipVisibleRooms(cacheArgs),
    chatRoomService.listImportantMessages().catch(() => []),
    getTranslations("App.Channels"),
  ]);
  return {
    roomId: findSokoBotDirectRoom(rooms, sokoBotId)?.id ?? null,
    chats: toImportantChats(important, tChannels("SavedMessages.untitled")),
  };
}

/**
 * `/` welcome: what happened while the user was away, and a way in via a
 * coworker. A user with a personal Soko Bot gets {@link SokoBotHome} instead,
 * a chat with their bot. Shared bots never take the home over: their room is
 * the team's, so a send from here would post for everyone. This is the post-login landing on every breakpoint — desktop gets
 * the full-page composition, mobile a version sized for a 390px column. The
 * room list is its own surface (`/chat` on mobile, the sidebar on
 * desktop) rather than something stacked underneath the welcome.
 *
 * Open rooms: `/chat/rooms/[roomId]`. Create Channel / Start New Direct are
 * in-place dialogs from the sidebar, not Welcome query modes.
 *
 * Instant Nav uses `(welcome)/loading.tsx` while this page streams after
 * `connection()`. Room open uses `chat/rooms/[roomId]/loading.tsx`.
 */
export default async function WelcomePage({ searchParams }: WelcomePageProps) {
  // Defer before any cookies()/headers()-bound work so PPR shell probing does
  // not soft-reject dynamic APIs on this dynamic page.
  await connection();

  const [query, session, activeOrganizationId, access, now, timeZone] =
    await Promise.all([
      searchParams,
      getSession(),
      userService.getActiveOrganizationId(),
      userService.getWorkspaceAccess().catch(() => null),
      getNow(),
      getTimeZone(),
    ]);
  // The app shell's loading fallback renders this page before the frame's
  // workspace gate redirects, so a brand-new account (sign-up lands here)
  // would read a bot, coworkers and tasks it has no workspace for. Leave
  // before any of those reads.
  if (!isWorkspaceReady(access?.gate)) {
    redirect(WORKSPACE_GATE_PATH);
  }
  // In an org the day is the team's; in a personal workspace, the user's.
  // In an org the greeting talks about the team, so count the whole
  // workspace rather than only the caller's own tasks.
  const scope = activeOrganizationId ? "workspace" : "owned";
  // The reads below need the gate, not the bot, so each one starts before the
  // bot read answers instead of one Core round trip after it.
  // The reader's Tasks due today or overdue, by their own calendar day. One
  // rendered promise shared by both compositions, like Needs you below.
  const today = dayInTimeZone(now, timeZone);
  const myDay = (
    <Suspense fallback={null}>
      {MyDay({
        feed: loadMyDay(today),
        overdue: countOverdue(today),
        today,
      })}
    </Suspense>
  );
  // What waits on the reader, as the quiet list under either welcome. One
  // promise of the rendered panel, so the two breakpoint compositions share
  // its reads instead of each loading the rows and their projects again.
  const needsYou = (
    <Suspense fallback={null}>
      {NeedsYouPanel({
        feed: panelFeed(
          notificationService.listNeedsYou(WORKSPACE_COLUMN_ROWS),
        ),
        // The workspace's first page of projects, read next to the rows, so
        // a row's project is usually known without its own read after them.
        projects: projectService
          .listProjects({ limit: PROJECTS_PAGE_LIMIT })
          .then(({ projects }) =>
            Object.fromEntries(
              projects.map((project) => [
                project.id,
                { name: project.name, logo: project.logo },
              ]),
            ),
          )
          .catch(() => ({})),
        quiet: true,
      })}
    </Suspense>
  );
  // Only the coworker welcome shows coworkers. The read settles here, so a
  // failure on the bot home, which never reads it, is not an unhandled
  // rejection.
  const coworkersRead = coworkerService.listCoworkers("chat").then(
    (rows) => ({ rows }),
    (error: unknown) => ({ error }),
  );
  const [sokoBot, summary] = await Promise.all([
    sokoBotService.getMine().catch(() => null),
    // Window is session-derived in Core (`max(Session.updatedAt)`). No stamp.
    taskService.getActivitySummary({ scope }),
  ]);
  const notice =
    (Array.isArray(query.notice) ? query.notice[0] : query.notice) ?? null;
  const landingNotice = <ChatLandingNotice notice={notice} />;
  const userId = session?.user.id;

  if (sokoBot && userId) {
    const [{ roomId, chats }, recent] = await Promise.all([
      loadSokoBotChats(sokoBot.id, { userId, activeOrganizationId }),
      taskService
        .listTasks({
          scope,
          sort: "updatedAt",
          limit: SOKO_BOT_HOME_TASK_LIMIT * 2,
        })
        .catch(() => ({ tasks: [] })),
    ]);
    return (
      <>
        {landingNotice}
        <SokoBotHome
          bot={{
            id: sokoBot.id,
            name: sokoBot.name,
            avatarSeed: sokoBot.avatarSeed,
            avatarImageUrl: sokoBot.avatarImageUrl ?? null,
          }}
          ownerId={userId}
          roomId={roomId}
          userName={resolveLandingGreetingName(session?.user.name)}
          summary={summary ?? null}
          teamTasks={toTeamDay(recent.tasks, new Date())}
          chats={chats}
          myDay={myDay}
          needsYou={needsYou}
        />
      </>
    );
  }

  const coworkersResult = await coworkersRead;
  if ("error" in coworkersResult) {
    throw coworkersResult.error;
  }
  const coworkers = coworkersResult.rows.map(mapDbCoworkerToChatCoworker);
  const greetingName = resolveLandingGreetingName(session?.user.name);

  return (
    <>
      {landingNotice}
      {/* One welcome per breakpoint. The compositions differ enough — six 64px
          teammates versus four at 44px — that CSS alone cannot bridge them. */}
      {/* A definite height (main's box less its p-4) so ChatLanding's middle
          column scrolls and the stats row stays in the first view. Main
          scrolls instead below 28rem. */}
      <div className="hidden min-h-full min-w-0 flex-1 flex-col md:flex md:h-[calc(100dvh-6rem-env(safe-area-inset-top))] md:min-h-[28rem] md:flex-none">
        <ChatLanding
          coworkers={coworkers}
          isOrganizationWorkspace={activeOrganizationId !== null}
          summary={summary}
          userName={greetingName}
          myDay={myDay}
          needsYou={needsYou}
        />
      </div>
      {/*
        Cancel authenticated-app-frame main `p-4` on mobile (same `-m-4` as
        `/chat` + room shell). Without this, the coworker strip scrollport
        is inset 16px and edge avatars clip at the pad, not the viewport.
        Pitch/stats/selected keep their own `px-4` inside ChatLandingMobile.
      */}
      <div className="bg-background -m-4 flex min-h-full min-w-0 flex-1 flex-col md:hidden">
        <ChatLandingMobile
          coworkers={coworkers}
          isOrganizationWorkspace={activeOrganizationId !== null}
          summary={summary}
          userName={greetingName}
          myDay={myDay}
          needsYou={needsYou}
        />
      </div>
    </>
  );
}
