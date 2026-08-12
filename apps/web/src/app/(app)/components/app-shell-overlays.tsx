import type { Session } from "@sokosumi/utils";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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

import { getCachedMyCredits } from "./private-sidebar-cache";
import {
  CoworkersHydrator,
  NoticeDialogHydrator,
} from "./shell-hydrators.client";
import { SubscriptionOnboardingDialogLoader } from "./subscription-onboarding-dialog-loader";

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

  // Settle the onboarding question on its own, before anything else is
  // awaited. It is the only input that can end this render, and for a user who
  // has already onboarded it costs nothing — `showOnboarding` returns straight
  // off the session flag without touching Core. Bundling it into the
  // Promise.all below made the one user who *is* redirected wait for notices
  // and the coworker list first, on a page they never see.
  //
  // Signup onboarding is its own full page. Redirecting from here rather than
  // from the layout keeps this off the app shell's critical path — the layout
  // is deliberately sync so Instant Nav can paint it without awaiting.
  if (await userService.showOnboarding(session)) {
    redirect("/onboarding");
  }

  const cookieStorePromise = cookies();
  const [pendingNoticesResult, coworkersResult, cookieStore] =
    await Promise.all([
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

  if (!subscriptionOnboardingGateAlreadyServed) {
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
      {shouldLoadSubscriptionOnboarding ? (
        <Suspense fallback={null}>
          <SubscriptionOnboardingDialogLoader
            activeOrganization={activeOrganization}
            loginId={session.session.id}
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
