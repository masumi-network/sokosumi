import type { Session } from "@sokosumi/utils";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import { getPendingNoticesAction } from "@/lib/actions/notice";
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

import { OnboardingDialogLoader } from "./onboarding-dialog-loader";
import {
  CoworkersHydrator,
  NoticeDialogHydrator,
} from "./shell-hydrators.client";

interface AppShellOverlaysProps {
  session: Session;
}

/**
 * Onboarding, pending notices, and coworkers hydration — streamed separately
 * from the private-cached sidebar chrome (`Suspense fallback={null}`).
 * Must not private-cache: cookies() for onboarding gate + non-chrome data.
 */
export default async function AppShellOverlays({
  session,
}: AppShellOverlaysProps) {
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

  return (
    <>
      <CoworkersHydrator coworkers={coworkers} />
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
