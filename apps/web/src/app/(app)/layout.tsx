import { NoticeKind } from "@sokosumi/utils";
import gravatarUrl from "gravatar-url";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import { HistorySearchDialogProvider } from "@/app/components/history-search-dialog-provider";
import { EmergencyDialog } from "@/components/emergency-dialog";
import { SidebarProvider } from "@/components/ui/sidebar";
import { getEnvPublicConfig } from "@/config/env.public";
import { AccountNoticeProvider } from "@/contexts/account-notice-provider";
import DynamicAblyProvider from "@/contexts/alby-provider.dynamic";
import { AppChatRailProvider } from "@/contexts/app-chat-rail-context";
import { ConversationsProvider } from "@/contexts/conversations-context";
import { CoworkersProvider } from "@/contexts/coworkers-context";
import { NotificationProvider } from "@/contexts/notification-provider";
import QueryProvider from "@/contexts/query-provider";
import { getPendingNoticesAction } from "@/lib/actions/notice";
import { hasAdminRole } from "@/lib/auth/admin-access";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import type {
  GetUsersByIdCreditsResponse,
  Notice,
} from "@/lib/clients/generated/core";
import { hermesBetaEnabled } from "@/lib/flags/hermes-beta";
import { userHasPaidOrEnterpriseCoverage, userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { designMdService } from "@/lib/services/design-md.service";
import {
  hasSubscriptionOnboardingGateBeenServedForSession,
  SUBSCRIPTION_ONBOARDING_GATE_SESSION_COOKIE_NAME,
} from "@/lib/subscription-onboarding-gate-cookie";
import { resolveSubscriptionOnboardingGateDecision } from "@/lib/subscription-onboarding-gate-decision";
import { DEFAULT_AUTHENTICATED_LANDING_PATH } from "@/lib/utils/landing-path";
import { resolveAccountNotice } from "./components/account-notice-state";
import { AuthSessionGuard } from "./components/auth-session-guard";
import ChatRail from "./components/chat-rail";
import Header from "./components/header";
import HeaderGate from "./components/header-gate";
import { LoginAccountNoticeToast } from "./components/login-account-notice-toast.client";
import { MarkSubscriptionOnboardingGateSeen } from "./components/mark-subscription-onboarding-gate-seen";
import { NoticeDialogProvider } from "./components/notice-dialog-context";
import { NotificationToastListener } from "./components/notification-toast-listener";
import { NotificationToaster } from "./components/notification-toaster.client";
import { OnboardingDialogLoader } from "./components/onboarding-dialog-loader";
import Sidebar from "./components/sidebar";

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
  const headersList = await headers();
  const pathname = headersList.get("x-pathname");

  // Redirect before rendering client providers. A redirect-only `/` page leaves
  // the router on `/` during client navigation and triggers hook mismatches.
  if (pathname === "/") {
    redirect(DEFAULT_AUTHENTICATED_LANDING_PATH);
  }

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
    coworkerService.listCoworkersForUi(),
    hermesBetaEnabled(),
    designMdService.resolveEffectiveDesignMd(),
  ]);
  const creditsResult = creditsResultRaw as GetUsersByIdCreditsResponse | null;
  const coworkers = coworkersResult.map(mapDbCoworkerToChatCoworker);
  const pendingNotices = pendingNoticesResult.ok
    ? pendingNoticesResult.data
    : [];
  const legalNotices = pendingNotices.filter(
    (notice: Notice) => notice.kind === NoticeKind.LEGAL_TERMS,
  );
  const announcementNotices = pendingNotices.filter(
    (notice: Notice) => notice.kind === NoticeKind.ANNOUNCEMENT,
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
  const subscriptionOnboardingGateAlreadyServed =
    hasSubscriptionOnboardingGateBeenServedForSession(
      subscriptionOnboardingGateCookie,
      session.session.id,
    );
  // Credits can report "free" while the user still has personal/org paid
  // coverage or an enterprise contract — check before mounting the gate.
  const shouldResolveCoverage =
    shouldShowFreeSubscriptionGate && !subscriptionOnboardingGateAlreadyServed;
  const hasPaidOrEnterpriseCoverage = shouldResolveCoverage
    ? await userHasPaidOrEnterpriseCoverage()
    : false;
  const subscriptionOnboardingGateDecision =
    resolveSubscriptionOnboardingGateDecision({
      alreadyServed: subscriptionOnboardingGateAlreadyServed,
      hasPaidOrEnterpriseCoverage,
      shouldShowFreeSubscriptionGate,
    });
  const shouldLoadSubscriptionOnboarding =
    subscriptionOnboardingGateDecision === "load";
  const shouldMarkSubscriptionOnboardingGateSeen =
    subscriptionOnboardingGateDecision === "mark-seen";
  const currentTimestampMs = creditsResult?.meta?.timestamp
    ? new Date(creditsResult.meta.timestamp).getTime()
    : 0;
  const lowCreditsThreshold =
    getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD;
  const accountNotice = resolveAccountNotice({
    credits: creditsData?.total ?? null,
    currentPlan,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    threshold: lowCreditsThreshold,
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
        <HistorySearchDialogProvider
          activeOrganizationId={session.session.activeOrganizationId ?? null}
        >
          <AppChatRailProvider defaultOpen={defaultChatRailOpen}>
            <Sidebar
              adminMenuEnabled={adminMenuEnabled}
              creditsData={creditsData}
              currentTimestampMs={currentTimestampMs}
              hermesMenuEnabled={hermesMenuEnabled}
              organizationName={activeOrganization?.name ?? null}
              session={session}
              lowCreditsThreshold={lowCreditsThreshold}
            />
            <div className="flex min-w-0 flex-1 overflow-clip" data-app-content>
              <div
                className="flex min-w-0 flex-1 flex-col overflow-clip"
                data-app-content-inner
              >
                <HeaderGate>
                  <Header className="h-16 p-4" session={session} />
                </HeaderGate>
                <main
                  className="relative flex max-h-[calc(100svh-64px)] min-h-[calc(100svh-64px)] flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 pt-20 md:pt-4"
                  data-app-main
                >
                  <EmergencyDialog />
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
        </HistorySearchDialogProvider>
      </SidebarProvider>
    </NoticeDialogProvider>
  );

  return (
    <QueryProvider>
      <AuthSessionGuard />
      <ConversationsProvider>
        <DynamicAblyProvider>
          <NotificationProvider userId={session.user.id}>
            <AccountNoticeProvider
              notice={accountNotice}
              sessionId={session.session.id}
            >
              <NotificationToaster />
              <NotificationToastListener userId={session.user.id} />
              <LoginAccountNoticeToast />
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
                ) : shouldMarkSubscriptionOnboardingGateSeen ? (
                  <MarkSubscriptionOnboardingGateSeen
                    loginId={session.session.id}
                  />
                ) : null}
              </CoworkersProvider>
            </AccountNoticeProvider>
          </NotificationProvider>
        </DynamicAblyProvider>
      </ConversationsProvider>
    </QueryProvider>
  );
}
