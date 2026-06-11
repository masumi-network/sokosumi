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
import { ConversationsProvider } from "@/contexts/conversations-context";
import { CoworkersProvider } from "@/contexts/coworkers-context";
import QueryProvider from "@/contexts/query-provider";
import { getPendingNoticesAction } from "@/lib/actions/notice";
import { hasAdminRole } from "@/lib/auth/admin-access";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { coreClient } from "@/lib/clients/core.client";
import type { GetUsersByIdCreditsResponse } from "@/lib/clients/generated/core";
import { hermesBetaEnabled } from "@/lib/flags/hermes-beta";
import { userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { designMdService } from "@/lib/services/design-md.service";
import {
  hasSubscriptionOnboardingGateBeenServedForSession,
  SUBSCRIPTION_ONBOARDING_GATE_SESSION_COOKIE_NAME,
} from "@/lib/subscription-onboarding-gate-cookie";

import { AuthSessionGuard } from "./components/auth-session-guard";
import ChatRail from "./components/chat-rail";
import EmailVerificationNotice from "./components/email-verification-notice";
import Header from "./components/header";
import HeaderGate from "./components/header-gate";
import LowCreditsNotice from "./components/low-credits-notice";
import { NoticeDialogProvider } from "./components/notice-dialog-context";
import { OnboardingDialogLoader } from "./components/onboarding-dialog-loader";
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
    creditsResultRaw,
    coworkersResult,
    hermesMenuEnabled,
    initialDesignMdAttachment,
  ] = await Promise.all([
    userService.showOnboarding(session),
    getPendingNoticesAction(),
    userService.getActiveOrganization(),
    coreClient.getMyCredits().catch(() => null),
    coworkerService.listCoworkers().catch(() => []),
    hermesBetaEnabled(),
    designMdService.resolveEffectiveDesignMd(),
  ]);
  const creditsResult = creditsResultRaw as GetUsersByIdCreditsResponse | null;
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
  const adminMenuEnabled = hasAdminRole(
    (session.user as typeof session.user & { role?: string | null }).role,
  );
  const creditsData = creditsResult?.data.credits ?? null;
  // Do not default to "free" when credits failed to load — that would show the
  // subscription-only onboarding gate (and Stripe/org work) for paid users.
  const currentPlan =
    creditsResult != null
      ? (creditsResult.data.subscription?.plan ?? "free")
      : null;
  const shouldShowFreeSubscriptionGate =
    !shouldShowOnboarding && currentPlan === "free";
  const subscriptionOnboardingGateCookie = cookieStore.get(
    SUBSCRIPTION_ONBOARDING_GATE_SESSION_COOKIE_NAME,
  )?.value;
  const shouldLoadSubscriptionOnboarding =
    shouldShowFreeSubscriptionGate &&
    !hasSubscriptionOnboardingGateBeenServedForSession(
      subscriptionOnboardingGateCookie,
      session.session.id,
    );
  const currentTimestampMs = creditsResult?.meta?.timestamp
    ? new Date(creditsResult.meta.timestamp).getTime()
    : 0;
  const topNotice = resolveAppTopNotice({
    credits: creditsData?.total ?? null,
    currentPlan,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    threshold: getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD,
  });

  const content = (
    <NoticeDialogProvider
      legalNotices={legalNotices}
      announcementNotices={announcementNotices}
    >
      <SidebarProvider
        defaultOpen={defaultOpen}
        data-app-shell
        className="flex max-w-svw overflow-clip"
      >
        <AppChatRailProvider defaultOpen={defaultChatRailOpen}>
          <Sidebar
            adminMenuEnabled={adminMenuEnabled}
            creditsData={creditsData}
            currentTimestampMs={currentTimestampMs}
            hermesMenuEnabled={hermesMenuEnabled}
            organizationName={activeOrganization?.name ?? null}
            session={session}
          />
          <div className="flex min-w-0 flex-1 overflow-clip" data-app-content>
            <div
              className="flex min-w-0 flex-1 flex-col overflow-clip"
              data-app-content-inner
            >
              <HeaderGate>
                <Header className="h-16 p-4" />
              </HeaderGate>
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
              initialDesignMdAttachment={initialDesignMdAttachment}
            />
          </div>
        </AppChatRailProvider>
      </SidebarProvider>
    </NoticeDialogProvider>
  );

  return (
    <QueryProvider>
      <AuthSessionGuard />
      <ConversationsProvider>
        <CoworkersProvider initialCoworkers={coworkers}>
          {content}
          {shouldShowOnboarding ? (
            <OnboardingDialogLoader
              activeOrganization={activeOrganization}
              loginId={session.session.id}
              subscriptionOnly={false}
            />
          ) : shouldLoadSubscriptionOnboarding ? (
            <OnboardingDialogLoader
              activeOrganization={activeOrganization}
              loginId={session.session.id}
              subscriptionOnly
            />
          ) : null}
        </CoworkersProvider>
      </ConversationsProvider>
    </QueryProvider>
  );
}
