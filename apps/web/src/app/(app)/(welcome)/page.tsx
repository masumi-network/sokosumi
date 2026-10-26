import { connection } from "next/server";

import { ChatLandingNotice } from "@/app/chat/components/chat-landing-notice";
import { ChatLanding } from "@/app/chat/components/landing/chat-landing";
import { ChatLandingMobile } from "@/app/chat/components/landing/chat-landing.mobile";
import { resolveLandingGreetingName } from "@/app/chat/components/landing/landing-content";
import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import { getSession } from "@/lib/auth/auth.server";
import { chatRoomService } from "@/lib/services/chat-room.service";
import { coworkerService } from "@/lib/services/coworker.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { taskService } from "@/lib/services/task.service";
import { userService } from "@/lib/services/user.service";

import { SokoBotHome } from "./components/soko-bot-home";
import {
  findSokoBotDirectRoom,
  SOKO_BOT_HOME_TASK_LIMIT,
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

  const [query, session, activeOrganizationId, sokoBot] = await Promise.all([
    searchParams,
    getSession(),
    userService.getActiveOrganizationId(),
    sokoBotService.getMine().catch(() => null),
  ]);
  const notice =
    (Array.isArray(query.notice) ? query.notice[0] : query.notice) ?? null;
  const landingNotice = <ChatLandingNotice notice={notice} />;
  const userId = session?.user.id;

  if (sokoBot && userId) {
    // In an org the day is the team's; in a personal workspace, the user's.
    const scope = activeOrganizationId ? "workspace" : "owned";
    const [roomId, summary, recent] = await Promise.all([
      loadSokoBotRoomId(sokoBot.id),
      taskService.getActivitySummary({ scope }),
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
        />
      </>
    );
  }

  const [coworkerRows, summary] = await Promise.all([
    coworkerService.listCoworkers("chat"),
    // Window is session-derived in Core (`max(Session.updatedAt)`). No stamp.
    taskService.getActivitySummary({
      // In an org the greeting talks about the team, so count the whole
      // workspace rather than only the caller's own tasks.
      scope: activeOrganizationId ? "workspace" : "owned",
    }),
  ]);
  const coworkers = coworkerRows.map(mapDbCoworkerToChatCoworker);
  const greetingName = resolveLandingGreetingName(session?.user.name);

  return (
    <>
      {landingNotice}
      {/* One welcome per breakpoint. The compositions differ enough — six 64px
          teammates versus four at 44px — that CSS alone cannot bridge them. */}
      <div className="hidden min-h-full min-w-0 flex-1 flex-col md:flex">
        <ChatLanding
          coworkers={coworkers}
          isOrganizationWorkspace={activeOrganizationId !== null}
          summary={summary}
          userName={greetingName}
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
        />
      </div>
    </>
  );
}
