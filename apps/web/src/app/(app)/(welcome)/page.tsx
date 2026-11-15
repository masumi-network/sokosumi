import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getNow, getTimeZone, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ChatLandingNotice } from "@/app/chat/components/chat-landing-notice";
import { resolveLandingGreetingName } from "@/app/chat/components/landing/landing-content";
import type { NeedsYouLead } from "@/app/projects/components/needs-you-panel-list";
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
  sokoBotFailureLead,
  toImportantChats,
  toNewSchedules,
  toTeamDay,
} from "./components/soko-bot-home-data";
import {
  SOKO_BOT_SETUP_FACES,
  SokoBotSetup,
} from "./components/soko-bot-setup";

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
 * The reader's rooms and their important unread chat messages from the last
 * day, which Core picks from Jev's tags; the room list is the sidebar's
 * cached one. Read before the bot is known, so the bot's Direct is found
 * after.
 */
async function loadHomeChats(): Promise<{
  rooms: Awaited<ReturnType<typeof chatRoomService.listRooms>>["rooms"];
  chats: SokoBotHomeChat[];
}> {
  const [{ rooms }, important, tChannels] = await Promise.all([
    chatRoomService.listRooms().catch(() => ({ rooms: [] })),
    chatRoomService.listImportantMessages().catch(() => []),
    getTranslations("App.Channels"),
  ]);
  return {
    rooms,
    chats: toImportantChats(important, tChannels("SavedMessages.untitled")),
  };
}

/**
 * `/` welcome. A user with a personal Soko Bot gets {@link SokoBotHome}, a
 * chat with their bot; anyone else gets {@link SokoBotSetup}, the way into
 * one. Shared bots never take the home over: their room is the team's, so a
 * send from here would post for everyone. This is the post-login landing on
 * every breakpoint. The room list is its own surface (`/chat` on mobile, the
 * sidebar on desktop) rather than something stacked underneath the welcome.
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
  // The reader's Tasks due today or overdue, by their own calendar day, for
  // the Soko Bot Home.
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
  // What waits on the reader, as the quiet list on the Soko Bot Home.
  const needsYouFeed = panelFeed(
    notificationService.listNeedsYou(WORKSPACE_COLUMN_ROWS),
  );
  // The workspace's first page of projects, read next to the rows, so a
  // row's project is usually known without its own read after them.
  const needsYouProjects = projectService
    .listProjects({ limit: PROJECTS_PAGE_LIMIT })
    .then(({ projects }) =>
      Object.fromEntries(
        projects.map((project) => [
          project.id,
          { name: project.name, logo: project.logo },
        ]),
      ),
    )
    .catch(() => ({}));
  const needsYouPanel = (lead?: NeedsYouLead) => (
    <Suspense fallback={null}>
      {NeedsYouPanel({
        feed: needsYouFeed,
        projects: needsYouProjects,
        quiet: true,
        lead,
      })}
    </Suspense>
  );
  // The Home's chats and team Tasks start with the bot read rather than one
  // Core round after it; without a bot they go unused.
  const homeChats = loadHomeChats();
  const recentTasks = taskService
    .listTasks({
      scope,
      sort: "updatedAt",
      limit: SOKO_BOT_HOME_TASK_LIMIT * 2,
    })
    .catch(() => ({ tasks: [] }));
  const [{ sokoBot, lastFailure }, summary] = await Promise.all([
    sokoBotService
      .getMineWithLastFailure()
      .catch(() => ({ sokoBot: null, lastFailure: null })),
    // Window is session-derived in Core (`max(Session.updatedAt)`). No stamp.
    taskService.getActivitySummary({ scope }),
  ]);
  const notice =
    (Array.isArray(query.notice) ? query.notice[0] : query.notice) ?? null;
  const landingNotice = <ChatLandingNotice notice={notice} />;
  const userId = session?.user.id;

  if (sokoBot && userId) {
    const [{ rooms, chats }, recent] = await Promise.all([
      homeChats,
      recentTasks,
    ]);
    const roomId = findSokoBotDirectRoom(rooms, sokoBot.id)?.id ?? null;
    // A failed bot waits on the reader too: the sidebar and the bot's page
    // say so, and Home said "Nothing waits on you".
    const tHome = await getTranslations("App.Chat.Landing.SokoBotHome");
    const failedLead = sokoBotFailureLead(
      {
        name: sokoBot.name?.trim() || tHome("defaultName"),
        status: sokoBot.status,
      },
      lastFailure,
      tHome,
    );
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
          schedules={toNewSchedules(sokoBot.schedules ?? [], new Date())}
          myDay={myDay}
          needsYou={needsYouPanel(failedLead)}
        />
      </>
    );
  }
  // Without pictures the page still offers the setup, only without the row.
  const avatars = await sokoBotService
    .listAvatars(SOKO_BOT_SETUP_FACES, [])
    .catch(() => []);
  return (
    <>
      {landingNotice}
      <SokoBotSetup avatars={avatars} />
    </>
  );
}
