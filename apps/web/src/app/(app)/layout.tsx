import { NoticeKind } from "@sokosumi/database";
import gravatarUrl from "gravatar-url";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import { EmergencyDialog } from "@/components/emergency-dialog";
import { SidebarProvider } from "@/components/ui/sidebar";
import { getEnvPublicConfig } from "@/config/env.public";
import { AppChatRailProvider } from "@/contexts/app-chat-rail-context";
import { ChatSecondarySidebarProvider } from "@/contexts/chat-secondary-sidebar-context";
import { ConversationsProvider } from "@/contexts/conversations-context";
import { CoworkersProvider } from "@/contexts/coworkers-context";
import QueryProvider from "@/contexts/query-provider";
import { getPendingNoticesAction } from "@/lib/actions/notice";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { coreClient } from "@/lib/clients/core.client";
import { taskRailEnabled } from "@/lib/flags/task-rail";
import { userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";

import ChatRail from "./components/chat-rail";
import EmailVerificationNotice from "./components/email-verification-notice";
import Header from "./components/header";
import LowCreditsNotice from "./components/low-credits-notice";
import { NoticeDialogProvider } from "./components/notice-dialog-context";
import { OnboardingDialog } from "./components/onboarding-dialog";
import Sidebar from "./components/sidebar";
import { resolveAppTopNotice } from "./components/top-notice-state";

interface AppLayoutProps {
  children: React.ReactNode;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Metadata");

  return {
    title: {
      default: t("Title.default"),
      template: t("Title.template"),
    },
    description: t("description"),
  };
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const cookieStorePromise = cookies();
  const session = await getSessionOrRedirect();

  const cookieStore = await cookieStorePromise;
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const defaultChatRailOpen =
    cookieStore.get("chat_sidebar_state")?.value === "true";

  const [
    shouldShowOnboarding,
    pendingNoticesResult,
    activeOrganization,
    isTaskRailEnabled,
    creditsResult,
    coworkersResult,
  ] = await Promise.all([
    userService.showOnboarding(session),
    getPendingNoticesAction(),
    userService.getActiveOrganization(),
    taskRailEnabled(),
    coreClient.getMyCredits().catch(() => null),
    coworkerService.listCoworkers("chat").catch(() => []),
  ]);
  const coworkers = coworkersResult.map(mapDbCoworkerToChatCoworker);
  const pendingNotices = pendingNoticesResult.ok
    ? pendingNoticesResult.data
    : [];
  const legalNotices = pendingNotices.filter(
    (notice) => notice.kind === NoticeKind.LEGAL_TERMS,
  );
  const announcementNotices = pendingNotices.filter(
    (notice) => notice.kind === NoticeKind.ANNOUNCEMENT,
  );
  const userImageUrl =
    session.user.image ??
    gravatarUrl(session.user.email ?? "", {
      size: 80,
      default: "404",
    });
  const creditsData = creditsResult?.data.credits ?? null;
  const currentTimestampMs = creditsResult?.meta?.timestamp
    ? new Date(creditsResult.meta.timestamp).getTime()
    : 0;
  const topNotice = resolveAppTopNotice({
    credits: creditsData?.total ?? null,
    currentPlan: creditsData?.subscription?.plan ?? "free",
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    threshold: getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD,
  });

  const content = (
    <NoticeDialogProvider
      legalNotices={legalNotices}
      announcementNotices={announcementNotices}
    >
      <ChatSecondarySidebarProvider>
        <SidebarProvider
          defaultOpen={defaultOpen}
          data-app-shell
          className="flex max-w-svw overflow-clip"
        >
          <AppChatRailProvider defaultOpen={defaultChatRailOpen}>
            <Sidebar
              creditsData={creditsData}
              currentTimestampMs={currentTimestampMs}
              organizationName={activeOrganization?.name ?? null}
              session={session}
              isTaskRailEnabled={isTaskRailEnabled}
            />
            <div className="flex min-w-0 flex-1 overflow-clip" data-app-content>
              <div
                className="flex min-w-0 flex-1 flex-col overflow-clip"
                data-app-content-inner
              >
                <Header
                  creditsData={creditsData}
                  currentTimestampMs={currentTimestampMs}
                  organizationName={activeOrganization?.name ?? null}
                  session={session}
                  className="h-16 p-4"
                />
                <main
                  className="relative flex max-h-[calc(100svh-64px)] min-h-[calc(100svh-64px)] flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 pt-20 md:pt-4"
                  data-app-main
                >
                  <EmergencyDialog />
                  {topNotice.kind === "emailVerification" ? (
                    <EmailVerificationNotice
                      email={topNotice.email}
                      emailVerified={false}
                    />
                  ) : null}
                  {topNotice.kind === "lowCredits" ||
                  topNotice.kind === "outOfCredits" ? (
                    <LowCreditsNotice
                      kind={topNotice.kind}
                      path={topNotice.path}
                    />
                  ) : null}
                  <div
                    className="flex h-full flex-1 flex-col overflow-visible"
                    data-app-main-inner
                  >
                    {children}
                  </div>
                </main>
              </div>
              <ChatRail
                organizationSlug={activeOrganization?.slug ?? null}
                userImageUrl={userImageUrl}
                userName={session.user.name ?? undefined}
              />
            </div>
          </AppChatRailProvider>
        </SidebarProvider>
      </ChatSecondarySidebarProvider>
    </NoticeDialogProvider>
  );

  return (
    <QueryProvider>
      <ConversationsProvider>
        <CoworkersProvider initialCoworkers={coworkers}>
          {content}
          {shouldShowOnboarding && <OnboardingDialog />}
        </CoworkersProvider>
      </ConversationsProvider>
    </QueryProvider>
  );
}
