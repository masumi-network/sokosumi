import type { Session } from "@sokosumi/utils";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import { getEnvPublicConfig } from "@/config/env.public";
import { getPendingNoticesAction } from "@/lib/actions/notice";
import { hasAdminRole } from "@/lib/auth/admin-access";
import { coreClient } from "@/lib/clients/core.client";
import type {
  GetUsersByIdCreditsResponse,
  Notice,
} from "@/lib/clients/generated/core";
import { NoticeKind } from "@/lib/clients/generated/core";
import { userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import {
  hasSubscriptionOnboardingGateBeenServedForSession,
  SUBSCRIPTION_ONBOARDING_GATE_SESSION_COOKIE_NAME,
} from "@/lib/subscription-onboarding-gate-cookie";

import { resolveAccountNotice } from "./account-notice-state";
import { OnboardingDialogLoader } from "./onboarding-dialog-loader";
import { NoticeDialogHydrator, ShellHydrators } from "./shell-hydrators.client";
import Sidebar from "./sidebar";

interface AppShellChromeProps {
  session: Session;
}

export default async function AppShellChrome({ session }: AppShellChromeProps) {
  await connection();
  const cookieStore = await cookies();
  const [
    shouldShowOnboarding,
    pendingNoticesResult,
    activeOrganization,
    creditsResultRaw,
    coworkersResult,
  ] = await Promise.all([
    userService.showOnboarding(session),
    getPendingNoticesAction(),
    userService.getActiveOrganization(),
    coreClient.getMyCredits().catch(() => null),
    coworkerService.listCoworkers().catch(() => []),
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
  const adminMenuEnabled = hasAdminRole(
    (session.user as typeof session.user & { role?: string | null }).role,
  );
  const creditsData = creditsResult?.data.credits ?? null;
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
  const shouldLoadSubscriptionOnboarding =
    shouldShowFreeSubscriptionGate && !subscriptionOnboardingGateAlreadyServed;
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

  return (
    <>
      <ShellHydrators accountNotice={accountNotice} coworkers={coworkers} />
      <Sidebar
        adminMenuEnabled={adminMenuEnabled}
        creditsData={creditsData}
        currentTimestampMs={currentTimestampMs}
        organizationName={activeOrganization?.name ?? null}
        session={session}
        lowCreditsThreshold={lowCreditsThreshold}
      />
      {shouldShowOnboarding ? (
        <Suspense fallback={null}>
          <OnboardingDialogLoader
            activeOrganization={activeOrganization}
            loginId={session.session.id}
            subscriptionOnly={false}
          />
        </Suspense>
      ) : shouldLoadSubscriptionOnboarding ? (
        <Suspense fallback={null}>
          <OnboardingDialogLoader
            activeOrganization={activeOrganization}
            loginId={session.session.id}
            subscriptionOnly
          />
        </Suspense>
      ) : null}
      <NoticeDialogHydrator
        announcementNotices={announcementNotices}
        legalNotices={legalNotices}
      />
    </>
  );
}
