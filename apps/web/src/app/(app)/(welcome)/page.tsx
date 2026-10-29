import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";

import { ChatLandingNotice } from "@/app/chat/components/chat-landing-notice";
import { ChatLanding } from "@/app/chat/components/landing/chat-landing";
import { ChatLandingMobile } from "@/app/chat/components/landing/chat-landing.mobile";
import { resolveLandingGreetingName } from "@/app/chat/components/landing/landing-content";
import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import { NeedsYouPanel } from "@/app/projects/components/workspace-column";
import { WorkspaceColumnPanelSkeleton } from "@/app/projects/components/workspace-column-skeleton";
import {
  projectsListStateQuery,
  WORKSPACE_COLUMN_ROWS,
} from "@/app/projects/constants";
import { getSession } from "@/lib/auth/auth.server";
import { chatRoomService } from "@/lib/services/chat-room.service";
import { coworkerService } from "@/lib/services/coworker.service";
import { notificationService } from "@/lib/services/notification.service";
import { projectService } from "@/lib/services/project.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { taskService } from "@/lib/services/task.service";
import { userService } from "@/lib/services/user.service";
import {
  HOME_BOARD_CLASS,
  HOME_BOARD_COLUMN_CLASS,
  HOME_STACK_CLASS,
} from "./components/home-layout";
import {
  HOME_PROJECT_LIMIT,
  HomeProjectsPanel,
  HomeTeamDayPanel,
} from "./components/home-panels";
import { SokoBotHome } from "./components/soko-bot-home";
import {
  findSokoBotDirectRoom,
  TEAM_DAY_TASK_LIMIT,
  toTeamDay,
} from "./components/soko-bot-home-data";

interface WelcomePageProps {
  searchParams: Promise<{
    notice?: string | string[];
  }>;
}

/** The bot's Direct, or null when it has none yet or the read fails. */
async function loadSokoBotRoomId(sokoBotId: string): Promise<string | null> {
  const { rooms } = await chatRoomService
    .listRooms("direct")
    .catch(() => ({ rooms: [] }));
  return findSokoBotDirectRoom(rooms, sokoBotId)?.id ?? null;
}

/** A panel's feed failing leaves that panel saying so, not the page erroring. */
function panelFeed<T>(promise: Promise<T[]>): Promise<T[] | null> {
  return promise.catch((error: unknown) => {
    console.warn("Home panel feed failed", { error });
    return null;
  });
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
 * Below either top sits Home's board: Needs you over the first projects on
 * the left, the team's last 24 hours wider on the right. It replaces the
 * Projects page's Workspace column; `/projects` keeps the full list.
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

  const [query, session, activeOrganizationId, sokoBot] = await Promise.all([
    searchParams,
    getSession(),
    userService.getActiveOrganizationId(),
    sokoBotService.getMine().catch(() => null),
  ]);
  const notice =
    (Array.isArray(query.notice) ? query.notice[0] : query.notice) ?? null;
  const userId = session?.user.id;
  const greetingName = resolveLandingGreetingName(session?.user.name);
  // In an org the day is the team's; in a personal workspace, the user's.
  const scope = activeOrganizationId ? "workspace" : "owned";

  // Started together, each awaited inside its own boundary below.
  const summaryPromise = taskService.getActivitySummary({ scope });
  const projectsPromise = panelFeed(
    projectService
      .listProjects({
        limit: HOME_PROJECT_LIMIT,
        ...projectsListStateQuery("open"),
      })
      .then((page) => page.projects),
  );
  const needsYouPromise = panelFeed(
    notificationService.listNeedsYou(WORKSPACE_COLUMN_ROWS),
  );
  const teamDayPromise = panelFeed(
    taskService
      .listTasks({ scope, sort: "updatedAt", limit: TEAM_DAY_TASK_LIMIT * 2 })
      .then(({ tasks }) => toTeamDay(tasks, new Date())),
  );

  const board = (
    <HomeBoard
      needsYou={
        <NeedsYouPanel feed={needsYouPromise} projects={projectsPromise} />
      }
      projects={<HomeProjectsPanel feed={projectsPromise} />}
      teamDay={
        <HomeTeamDayPanel feed={teamDayPromise} summary={summaryPromise} />
      }
    />
  );

  if (sokoBot && userId) {
    const roomId = await loadSokoBotRoomId(sokoBot.id);
    return (
      <HomeLayout notice={notice} board={board}>
        <SokoBotHome
          bot={{
            id: sokoBot.id,
            name: sokoBot.name,
            avatarSeed: sokoBot.avatarSeed,
            avatarImageUrl: sokoBot.avatarImageUrl ?? null,
          }}
          ownerId={userId}
          roomId={roomId}
          userName={greetingName}
          summary={await summaryPromise}
        />
      </HomeLayout>
    );
  }

  const coworkers = (await coworkerService.listCoworkers("chat")).map(
    mapDbCoworkerToChatCoworker,
  );

  return (
    <HomeLayout notice={notice} board={board}>
      {/* One welcome per breakpoint. The compositions differ enough — the
          desktop mark and larger type versus Search agents and a full-width
          Start chat on the phone — that CSS alone cannot bridge them. */}
      <div className="hidden min-w-0 flex-col md:flex">
        <ChatLanding coworkers={coworkers} userName={greetingName} />
      </div>
      {/*
        Cancel authenticated-app-frame main `p-4` on mobile (same `-m-4` as
        `/chat` + room shell). Without this, the coworker strip scrollport
        is inset 16px and edge avatars clip at the pad, not the viewport.
        Pitch/selected keep their own `px-4` inside ChatLandingMobile.
      */}
      <div className="bg-background -m-4 flex min-w-0 flex-col md:hidden">
        <ChatLandingMobile coworkers={coworkers} userName={greetingName} />
      </div>
    </HomeLayout>
  );
}

function HomeLayout({
  notice,
  board,
  children,
}: {
  notice: string | null;
  board: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <ChatLandingNotice notice={notice} />
      <div className={HOME_STACK_CLASS}>
        {children}
        {board}
      </div>
    </>
  );
}

/** Home's board; its layout lives in {@link HOME_BOARD_CLASS}. */
function HomeBoard({
  needsYou,
  projects,
  teamDay,
}: {
  needsYou: ReactNode;
  projects: ReactNode;
  teamDay: ReactNode;
}) {
  return (
    <div className={HOME_BOARD_CLASS}>
      <div className={HOME_BOARD_COLUMN_CLASS}>
        <Suspense
          fallback={
            <WorkspaceColumnPanelSkeleton testId="home-needs-you-loading" />
          }
        >
          {needsYou}
        </Suspense>
        <Suspense
          fallback={
            <WorkspaceColumnPanelSkeleton testId="home-projects-loading" />
          }
        >
          {projects}
        </Suspense>
      </div>
      <Suspense
        fallback={
          <WorkspaceColumnPanelSkeleton testId="home-team-day-loading" />
        }
      >
        {teamDay}
      </Suspense>
    </div>
  );
}
