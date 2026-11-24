import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTimeZone, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ChatLandingNotice } from "@/app/chat/components/chat-landing-notice";
import { resolveLandingGreetingName } from "@/app/chat/components/landing/landing-content";
import type { NeedsYouLead } from "@/app/projects/components/needs-you-panel-list";
import { NeedsYouPanel } from "@/app/projects/components/workspace-column";
import { PROJECTS_PAGE_LIMIT } from "@/app/projects/constants";
import { dayInTimeZone } from "@/app/tasks/utils/task-due";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";
import { projectService } from "@/lib/services/project.service";
import { isWorkspaceReady, WORKSPACE_GATE_PATH } from "@/lib/workspace-gate";

import { countOverdue, loadMyDay, MyDay } from "./components/my-day";
import { SokoBotHome } from "./components/soko-bot-home";
import {
  sokoBotFailureLead,
  sokoBotWelcomeLead,
  toImportantChats,
  toNewSchedules,
  toTeamDay,
  withSokoBotChat,
} from "./components/soko-bot-home-data";
import { SokoBotSetup } from "./components/soko-bot-setup";
import { loadHomeData, loadHomeGate } from "./home-page-data";

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
 * Instant Nav uses `(welcome)/loading.tsx` while this page streams. Its Core
 * reads are cached for the browser only, so a link prefetch carries Home.
 * Room open uses `chat/rooms/[roomId]/loading.tsx`.
 */
export default async function WelcomePage({ searchParams }: WelcomePageProps) {
  const [query, gate, timeZone] = await Promise.all([
    searchParams,
    loadHomeGate(),
    getTimeZone(),
  ]);
  // The app shell's loading fallback renders this page before the frame's
  // workspace gate redirects, so a brand-new account (sign-up lands here)
  // would read a bot, coworkers and tasks it has no workspace for. Leave
  // before any of those reads.
  if (!isWorkspaceReady(gate.gate)) {
    redirect(WORKSPACE_GATE_PATH);
  }
  const { activeOrganizationId, userId, userName, now } = gate;
  // In an org the day is the team's; in a personal workspace, the user's.
  // In an org the greeting talks about the team, so count the whole
  // workspace rather than only the caller's own tasks.
  const scope = activeOrganizationId ? "workspace" : "owned";
  // The reads below need the gate, not the bot, so each one starts before the
  // bot read answers instead of one Core round trip after it.
  // The reader's Tasks due today or overdue, by their own calendar day, for
  // the Soko Bot Home.
  const today = dayInTimeZone(now, timeZone);
  // My day and the Needs you projects are uncached Core reads. Each waits for
  // the request, so a link prefetch leaves them as holes: an uncached read
  // started while a prefetch renders would cut that prefetch short.
  const request = connection();
  const myDay = (
    <Suspense fallback={null}>
      {MyDay({
        feed: request.then(() => loadMyDay(today)),
        overdue: request.then(() => countOverdue(today)),
        today,
      })}
    </Suspense>
  );
  const homeData = loadHomeData(scope);
  // What waits on the reader, as the quiet list on the Soko Bot Home.
  // Caught so a failed Home read, which errors the page below, leaves no
  // unhandled rejection behind.
  const needsYouFeed = homeData
    .then(({ needsYou }) => needsYou?.notifications ?? null)
    .catch(() => null);
  // The workspace's first page of projects, read next to the rows, so a
  // row's project is usually known without its own read after them.
  const needsYouProjects = request
    .then(() => projectService.listProjects({ limit: PROJECTS_PAGE_LIMIT }))
    .then(({ projects }) =>
      Object.fromEntries(
        projects.map((project) => [
          project.id,
          { name: project.name, logo: project.logo },
        ]),
      ),
    )
    .catch(() => ({}));
  const needsYouPanel = (leads: NeedsYouLead[]) => (
    <Suspense fallback={null}>
      {NeedsYouPanel({
        feed: needsYouFeed,
        projects: needsYouProjects,
        quiet: true,
        leads,
      })}
    </Suspense>
  );
  const {
    botRoom,
    needsYou,
    important,
    recentTasks,
    sokoBot,
    lastFailure,
    summary: readSummary,
  } = await homeData;
  // TEMP (SOKD-391 evidence, reverted before merge): controlled failures.
  const fail = query.notice === "sokd391-fail-page";
  if (fail) throw new Error("SOKD-391 controlled Home failure");
  const summary = query.notice === "sokd391-fail-stats" ? null : readSummary;
  const notice =
    (Array.isArray(query.notice) ? query.notice[0] : query.notice) ?? null;
  const landingNotice = (everyVisit = false) => (
    <>
      <RefreshPrefetchedPage everyVisit={everyVisit} />
      <ChatLandingNotice notice={notice} />
    </>
  );

  if (sokoBot && userId) {
    const roomId = botRoom?.roomId ?? null;
    // A failed bot waits on the reader too: the sidebar and the bot's page
    // say so, and Home said "Nothing waits on you".
    const [tHome, tChannels] = await Promise.all([
      getTranslations("App.Chat.Landing.SokoBotHome"),
      getTranslations("App.Channels"),
    ]);
    const botName = sokoBot.name?.trim() || tHome("defaultName");
    const untitled = tChannels("SavedMessages.untitled");
    const failedLead = sokoBotFailureLead(
      { name: botName, status: sokoBot.status },
      lastFailure,
      tHome,
    );
    // Right after setup the bot's welcome waits unread, and Needs you said
    // nothing did.
    const welcomeLead = sokoBotWelcomeLead(
      { id: sokoBot.id, name: botName },
      botRoom,
      tHome,
    );
    return (
      <>
        {/* A copy kept from before the welcome was read would still list it. */}
        {landingNotice(welcomeLead !== undefined)}
        <SokoBotHome
          bot={{
            id: sokoBot.id,
            name: sokoBot.name,
            avatarSeed: sokoBot.avatarSeed,
            avatarImageUrl: sokoBot.avatarImageUrl ?? null,
            avatarCode: sokoBot.avatarCode ?? null,
            status: sokoBot.status,
          }}
          ownerId={userId}
          roomId={roomId}
          userName={resolveLandingGreetingName(userName)}
          summary={summary ?? null}
          inOrganization={Boolean(activeOrganizationId)}
          // Its own number, not a share of the waiting Tasks: Needs you also
          // holds Job, grant and access asks, and asks from other workspaces.
          needsYouCount={needsYou?.total ?? null}
          now={now}
          teamTasks={toTeamDay(recentTasks, now)}
          // Unread important messages, plus the reader's latest chat with
          // the bot even once read, so a first chat does not leave Home
          // saying nothing moved.
          chats={withSokoBotChat(
            toImportantChats(important, untitled),
            botRoom,
            { userId, from: tHome("youTo", { name: botName }), untitled },
            now,
          )}
          schedules={toNewSchedules(sokoBot.schedules ?? [], now)}
          myDay={myDay}
          needsYou={needsYouPanel(
            [welcomeLead, failedLead].filter((lead) => lead !== undefined),
          )}
        />
      </>
    );
  }
  return (
    <>
      {landingNotice()}
      <SokoBotSetup />
    </>
  );
}
