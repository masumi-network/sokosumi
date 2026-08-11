import gravatarUrl from "gravatar-url";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import HermesExperience from "@/app/personal-assistant/components/hermes-experience";
import LoadingState from "@/app/personal-assistant/components/loading-state";
import {
  buildSubscriptionWallPlans,
  resolveHermesHasActiveSubscription,
} from "@/app/personal-assistant/hermes-page-subscription";
import { getSession } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import type { GetSubscriptionCatalogResponse } from "@/lib/clients/generated/core";
import { hasPaidPlanCoverage } from "@/lib/hermes/paid-plan-coverage";
import { userService } from "@/lib/services/user.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Hermes.Metadata");
  return {
    title: t("title"),
    description: t("description"),
  };
}

interface HermesExperienceWithAccessProps {
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userImageUrl: string | null;
  activeOrganizationId: string | null;
  userRole: string | null | undefined;
}

/**
 * Deferred billing + membership work. Suspends under the page Suspense
 * so LoadingState paints before paid-plan coverage / catalog finish
 * (SOK-780). Fail-closed gate once resolved.
 */
type MembershipList = Awaited<
  ReturnType<typeof userService.getMyMembersWithOrganizations>
>;

export async function HermesExperienceWithAccess({
  userId,
  userName,
  userEmail,
  userImageUrl,
  activeOrganizationId,
  userRole,
}: HermesExperienceWithAccessProps) {
  // Catalog does not need org IDs — start it with memberships so multi-org
  // membership latency does not serialize catalog TTI after the shell.
  const catalogPromise: Promise<GetSubscriptionCatalogResponse | null> = userId
    ? coreClient.getSubscriptionCatalog().catch(() => null)
    : Promise.resolve(null);

  // Org context for the confirmation-card dropdown (lets the user reroute
  // sokosumi_create_task / sokosumi_create_job into the right workspace
  // before approving). Empty list when not signed in or no memberships.
  const memberships: MembershipList = userId
    ? await userService
        .getMyMembersWithOrganizations()
        .catch((): MembershipList => [])
    : [];
  const organizations = memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
  }));

  // Activating and using the assistant requires a paid plan — viewing the
  // page (landing content, chat history) stays open to everyone. Fail closed:
  // if the coverage lookups error we can't confirm a subscription, so treat
  // the user as unsubscribed here. This is only the UX-level gate; Core
  // re-checks on provision / chat / mutations. Admins skip the wall
  // entirely so the team can set up and test instances without billing.
  // Coverage = personal Stripe plan OR any member org's billing plan
  // (enterprise contract or paid self-serve) — same rule as Core.
  const [hasCoverage, catalogResult] = await Promise.all([
    userId
      ? hasPaidPlanCoverage({
          organizationIds: memberships.map((m) => m.organization.id),
        })
      : Promise.resolve(false),
    catalogPromise,
  ]);
  const hasActiveSubscription = resolveHermesHasActiveSubscription(
    hasCoverage,
    userRole,
  );

  // The 3 paid plans — gives the subscription wall real, clickable plan
  // links instead of a vague "upgrade to unlock". Best-effort: the wall
  // still works (minus the plan links) if the catalog fetch fails.
  const subscriptionWallPlans = buildSubscriptionWallPlans(catalogResult);

  return (
    <HermesExperience
      userId={userId}
      userName={userName}
      userEmail={userEmail}
      userImageUrl={userImageUrl}
      organizations={organizations}
      activeOrganizationId={activeOrganizationId}
      hasActiveSubscription={hasActiveSubscription}
      subscriptionWallPlans={subscriptionWallPlans}
    />
  );
}

/**
 * Session-only fast path. Memberships, paid-plan coverage, and the
 * subscription catalog stream behind Suspense so first paint is the
 * loading shell (also used by loading.tsx for route transitions).
 */
export default async function HermesPage() {
  const session = await getSession();
  const userName = session?.user.name ?? null;
  const userEmail = session?.user.email ?? null;
  const userImageUrl = session?.user.image
    ? session.user.image
    : session?.user.email
      ? gravatarUrl(session.user.email, { size: 80, default: "404" })
      : null;
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;

  return (
    <Suspense fallback={<LoadingState />}>
      <HermesExperienceWithAccess
        userId={session?.user.id ?? null}
        userName={userName}
        userEmail={userEmail}
        userImageUrl={userImageUrl}
        activeOrganizationId={activeOrganizationId}
        userRole={session?.user.role}
      />
    </Suspense>
  );
}
