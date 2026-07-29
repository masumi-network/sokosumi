import { PERSONAL_ASSISTANT_PLANS } from "@sokosumi/utils";
import gravatarUrl from "gravatar-url";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import HermesExperience from "@/app/personal-assistant/components/hermes-experience";
import LoadingState from "@/app/personal-assistant/components/loading-state";
import type { SubscriptionWallPlan } from "@/app/personal-assistant/components/subscription-required-dialog";
import { getSession } from "@/lib/auth/auth.server";
import { hasAdminRole } from "@/lib/auth/has-admin-role";
import { coreClient } from "@/lib/clients/core.client";
import type { GetSubscriptionCatalogResponse } from "@/lib/clients/generated/core";
import { hasAssistantPlanCoverage } from "@/lib/hermes/assistant-plan-coverage";
import { userService } from "@/lib/services/user.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Hermes.Metadata");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function HermesPage() {
  const session = await getSession();
  const userName = session?.user.name ?? null;
  const userEmail = session?.user.email ?? null;
  const userImageUrl = session?.user.image
    ? session.user.image
    : session?.user.email
      ? gravatarUrl(session.user.email, { size: 80, default: "404" })
      : null;

  // Org context for the confirmation-card dropdown (lets the user reroute
  // sokosumi_create_task / sokosumi_create_job into the right workspace
  // before approving). Empty list when not signed in or no memberships.
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const memberships = session
    ? await userService
        .getMyMembersWithOrganizations()
        .catch(
          () =>
            [] as Awaited<
              ReturnType<typeof userService.getMyMembersWithOrganizations>
            >,
        )
    : ([] as Awaited<
        ReturnType<typeof userService.getMyMembersWithOrganizations>
      >);
  const organizations = memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
  }));

  // Activating and using the assistant requires Standard or better — viewing
  // the page (landing content, chat history) stays open to everyone. Fail
  // closed: if the coverage lookups error we can't confirm a subscription, so
  // treat the user as unsubscribed here. This is only the UX-level gate; Core
  // re-checks on provision / chat / mutations. Admins skip the wall
  // entirely so the team can set up and test instances without billing.
  // Coverage = personal Stripe plan OR any member org's billing plan
  // (enterprise contract or self-serve Standard+) — same rule as Core.
  const [hasCoverage, catalogResultRaw] = await Promise.all([
    session
      ? hasAssistantPlanCoverage({
          organizationIds: memberships.map((m) => m.organization.id),
        })
      : Promise.resolve(false),
    session ? coreClient.getSubscriptionCatalog().catch(() => null) : null,
  ]);
  // Admins skip the wall so the team can operate test instances without billing.
  const canUseAssistant = hasCoverage || hasAdminRole(session?.user.role);

  // Only the plans that actually unlock the assistant — offering Starter
  // here would sell an upgrade that still hits the wall. Best-effort: the
  // wall still works (minus the plan links) if the catalog fetch fails.
  const catalogResult =
    catalogResultRaw as GetSubscriptionCatalogResponse | null;
  const subscriptionWallPlans: SubscriptionWallPlan[] = catalogResult
    ? PERSONAL_ASSISTANT_PLANS.map((name) => {
        const plan = catalogResult.data[name];
        return {
          name,
          monthlyAmount: plan.monthlyAmount,
          currency: plan.currency,
          credits: plan.credits,
        };
      })
    : [];

  return (
    <Suspense fallback={<LoadingState />}>
      <HermesExperience
        userId={session?.user.id ?? null}
        userName={userName}
        userEmail={userEmail}
        userImageUrl={userImageUrl}
        organizations={organizations}
        activeOrganizationId={activeOrganizationId}
        hasAssistantPlanCoverage={canUseAssistant}
        subscriptionWallPlans={subscriptionWallPlans}
      />
    </Suspense>
  );
}
