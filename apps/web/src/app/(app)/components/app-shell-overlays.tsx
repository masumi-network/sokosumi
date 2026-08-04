import type { Session } from "@sokosumi/utils";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import { getPendingNoticesAction } from "@/lib/actions/notice";
import type { Notice, Organization } from "@/lib/clients/generated/core";
import { NoticeKind } from "@/lib/clients/generated/core";
import { userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import {
  hasSubscriptionOnboardingGateBeenServedForSession,
  SUBSCRIPTION_ONBOARDING_GATE_SESSION_COOKIE_NAME,
} from "@/lib/subscription-onboarding-gate-cookie";

import { OnboardingDialogLoader } from "./onboarding-dialog-loader";
import { getCachedMyCredits } from "./private-sidebar-cache";
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
 *
 * Credits/org are fetched only on the branches that need them so we do not
 * always duplicate the private sidebar Core reads.
 */
export default async function AppShellOverlays({
  session,
}: AppShellOverlaysProps) {
  // Defer before cookies()/Core so Cache Components PPR probing does not
  // soft-reject dynamic APIs while filling this Suspense hole (#3617).
  await connection();
  const cookieStorePromise = cookies();
  const [
    shouldShowOnboarding,
    pendingNoticesResult,
    coworkersResult,
    cookieStore,
  ] = await Promise.all([
    userService.showOnboarding(session),
    getPendingNoticesAction(),
    coworkerService.listCoworkers().catch(() => []),
    cookieStorePromise,
  ]);
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

  const subscriptionOnboardingGateCookie = cookieStore.get(
    SUBSCRIPTION_ONBOARDING_GATE_SESSION_COOKIE_NAME,
  )?.value;
  const subscriptionOnboardingGateAlreadyServed =
    hasSubscriptionOnboardingGateBeenServedForSession(
      subscriptionOnboardingGateCookie,
      session.session.id,
    );

  let activeOrganization: Organization | null = null;
  let shouldLoadSubscriptionOnboarding = false;

  if (shouldShowOnboarding) {
    activeOrganization = await userService.getActiveOrganization();
  } else if (!subscriptionOnboardingGateAlreadyServed) {
    // Shared React.cache with PrivateCachedAppSidebar — one Core hit per request
    // when both cold-fill; skipped entirely when gate already served.
    const creditsResult = await getCachedMyCredits();
    const currentPlan =
      creditsResult != null
        ? (creditsResult.data.subscription?.plan ?? "free")
        : null;
    if (currentPlan === "free") {
      activeOrganization = await userService.getActiveOrganization();
      shouldLoadSubscriptionOnboarding = true;
    }
  }

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
