import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { ChatLandingNotice } from "@/app/chat/components/chat-landing-notice";
import { MobileChatHomeRedirect } from "@/app/chat/components/mobile-chat-home-redirect.client";
import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/auth.server";
import { userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";
import { ChatLanding } from "./components/landing/chat-landing";
import { RoomsClient } from "./components/rooms-client";
import { loadOrganizationMembers } from "./load-organization-members";
import { firstSearchValue } from "./load-room-messages";

/**
 * How stale the recorded visit must be before a page view counts as a new one.
 * Long enough that reloading, or bouncing back from a room, keeps showing the
 * same "while you were gone" summary.
 */
const LAST_SEEN_REFRESH_MS = 30 * 60 * 1000;

interface ChatPageProps {
  searchParams: Promise<{
    create?: string | string[];
    dm?: string | string[];
    notice?: string | string[];
  }>;
}

/**
 * `/chat` landing: a desktop welcome summarising what happened while the user
 * was away; mobile bare home redirects to `/chat/chats`. Draft modes via
 * query: `?create=channel`, `?dm=new`. Open rooms: `/chat/rooms/[roomId]`.
 *
 * Instant Nav uses `chat/loading.tsx` while this page streams after
 * `connection()`. Room open uses `rooms/[roomId]/loading.tsx`.
 */
export default async function ChatPage({ searchParams }: ChatPageProps) {
  // Defer before any cookies()/headers()-bound work so PPR shell probing does
  // not soft-reject dynamic APIs on this dynamic page.
  await connection();

  // Ordinary landing only needs session + coworkers. Draft create/DM paths
  // load org context and channel copy below so the Instant-streamed landing
  // stays light (heavy work only when draft query modes are active).
  const [query, session] = await Promise.all([searchParams, getSession()]);

  const isCreateChannelRequested = firstSearchValue(query.create) === "channel";
  const isNewDirectMessage = firstSearchValue(query.dm) === "new";
  const notice = firstSearchValue(query.notice);
  const landingNotice = <ChatLandingNotice notice={notice} />;

  if (isCreateChannelRequested || isNewDirectMessage) {
    const [tChannels, activeOrganization] = await Promise.all([
      getTranslations("App.Channels"),
      userService.getActiveOrganization(),
    ]);

    // Channels / create stay org-only. Start New DM (`?dm=new`) also works in
    // personal workspace: same DraftDirectMessage UI with empty members so the
    // picker is coworkers-only (solo coworker sends via room ensure).
    if (!activeOrganization) {
      if (!isNewDirectMessage) {
        return (
          <>
            {landingNotice}
            <div className="min-h-full w-full px-4 py-6">
              <div className="mx-auto max-w-3xl">
                <Card>
                  <CardHeader>
                    <CardTitle>{tChannels("NoOrganization.title")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">
                      {tChannels("NoOrganization.description")}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        );
      }

      const coworkers = await coworkerService.listCoworkers("chat");

      return (
        <>
          {landingNotice}
          <RoomsClient
            activeOrganization={null}
            rooms={[]}
            organizationMembers={[]}
            currentUserId={session?.user.id ?? ""}
            coworkers={coworkers}
            selectedRoomId={null}
            isCreateChannelRequested={false}
            isNewDirectMessage
            messageLoadFailed={false}
            membersLoadFailed={false}
            messages={[]}
            messagesNextCursor={null}
          />
        </>
      );
    }

    // Create/DM drafts do not need a rooms list — RoomsClient only looks up
    // selectedRoom by id, and sidebar already owns paginated room history.
    const [membersPage, coworkers, currentMember] = await Promise.all([
      loadOrganizationMembers(activeOrganization.id),
      coworkerService.listCoworkers("chat"),
      userService.getMyMemberInOrganization(activeOrganization.id),
    ]);

    return (
      <>
        {landingNotice}
        <RoomsClient
          activeOrganization={activeOrganization}
          rooms={[]}
          organizationMembers={membersPage.members}
          currentUserId={currentMember?.userId ?? ""}
          coworkers={coworkers}
          selectedRoomId={null}
          isCreateChannelRequested={isCreateChannelRequested}
          isNewDirectMessage={isNewDirectMessage}
          messageLoadFailed={false}
          membersLoadFailed={membersPage.failed}
          messages={[]}
          messagesNextCursor={null}
        />
      </>
    );
  }

  const activeOrganizationId = await userService.getActiveOrganizationId();

  const [coworkerRows, summary] = await Promise.all([
    coworkerService.listCoworkers("chat"),
    // Core reads the window from the stored lastSeenAt itself — a session
    // cookie can lag the column and would silently zero the counts.
    taskService.getActivitySummary({
      // In an org the greeting talks about the team, so count the whole
      // workspace rather than only the caller's own tasks.
      scope: activeOrganizationId ? "workspace" : "owned",
    }),
  ]);
  const coworkers = coworkerRows.map(mapDbCoworkerToChatCoworker);

  // After reading the window, not before, or the user always sees zero — and
  // only once the previous visit is genuinely old. Stamping on every load meant
  // a reload moved the window to "a second ago" and blanked the summary the
  // user had just been shown.
  const shouldAdvanceLastSeen =
    summary.since === null ||
    Date.now() - summary.since.getTime() >= LAST_SEEN_REFRESH_MS;
  if (shouldAdvanceLastSeen) {
    await userService.markLastSeenForMe();
  }

  return (
    <>
      {landingNotice}
      <div className="hidden md:contents">
        <ChatLanding
          coworkers={coworkers}
          isOrganizationWorkspace={activeOrganizationId !== null}
          lastSeenAt={summary.since}
          summary={summary}
          userName={session?.user.name ?? null}
        />
      </div>
      <MobileChatHomeRedirect />
    </>
  );
}
