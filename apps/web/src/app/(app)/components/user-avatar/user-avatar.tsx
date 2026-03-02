import { MemberWithOrganization } from "@sokosumi/database";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import {
  type ActiveSubscription,
  parsePlanName,
  resolveCurrentPlanName,
} from "@/components/billing/subscription-plan-utils";
import { auth, Session } from "@/lib/auth/auth";
import { userService } from "@/lib/services";
import { getLatestActiveOrganizationSubscription } from "@/lib/stripe/subscription-utils";
import { CreditUsage } from "@/lib/types/credit";

import UserAvatarClient from "./user-avatar.client";
import UserAvatarSkeleton from "./user-avatar-skeleton";

interface UserAvatarProps {
  activeWorkspacePlanLabel: string;
  creditUsage?: CreditUsage | null;
  currentTimestampMs: number;
  creditsLabel?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  session: Session;
  subscriptionPeriodEndMs?: number | null;
}

const PERSONAL_WORKSPACE_KEY = "personal-account";

async function getWorkspacePlanLabels(
  members: MemberWithOrganization[],
  activeOrganizationId: string | null,
): Promise<Record<string, string>> {
  const requestHeaders = await headers();
  const tPlan = await getTranslations("App.Header.Plan");
  const tSubscriptions = await getTranslations("App.Subscriptions");
  const unavailablePlanLabel = tPlan("unavailable");

  const workspacePlanEntries = await Promise.all([
    (async () => {
      // Skip fetching for personal workspace if it's the active workspace
      if (activeOrganizationId === null) {
        return [PERSONAL_WORKSPACE_KEY, ""] as const;
      }

      try {
        const activeSubscriptions = await auth.api.listActiveSubscriptions({
          headers: requestHeaders,
          query: {
            customerType: "user",
          },
        });

        const currentPlan =
          resolveCurrentPlanName(activeSubscriptions as ActiveSubscription[]) ??
          "free";
        const planName = tSubscriptions(`Plans.${currentPlan}.name`);

        return [PERSONAL_WORKSPACE_KEY, planName] as const;
      } catch (_error) {
        return [PERSONAL_WORKSPACE_KEY, unavailablePlanLabel] as const;
      }
    })(),
    ...members.map(async (member) => {
      // Skip fetching for this organization if it's the active workspace
      if (member.organization.id === activeOrganizationId) {
        return [member.organization.id, ""] as const;
      }

      try {
        const activeSubscription =
          await getLatestActiveOrganizationSubscription({
            organizationId: member.organization.id,
          });
        const currentPlan = parsePlanName(activeSubscription?.plan) ?? "free";
        const planName = tSubscriptions(`Plans.${currentPlan}.name`);

        return [member.organization.id, planName] as const;
      } catch (_error) {
        return [member.organization.id, unavailablePlanLabel] as const;
      }
    }),
  ]);

  return Object.fromEntries(workspacePlanEntries);
}

export default async function UserAvatar({
  activeWorkspacePlanLabel,
  creditUsage,
  currentTimestampMs,
  creditsLabel,
  primaryLabel,
  secondaryLabel,
  session,
  subscriptionPeriodEndMs,
}: UserAvatarProps) {
  return (
    <Suspense fallback={<UserAvatarSkeleton />}>
      <UserAvatarInner
        activeWorkspacePlanLabel={activeWorkspacePlanLabel}
        session={session}
        creditUsage={creditUsage}
        currentTimestampMs={currentTimestampMs}
        creditsLabel={creditsLabel}
        primaryLabel={primaryLabel}
        secondaryLabel={secondaryLabel}
        subscriptionPeriodEndMs={subscriptionPeriodEndMs}
      />
    </Suspense>
  );
}

async function UserAvatarInner({
  activeWorkspacePlanLabel,
  creditUsage,
  currentTimestampMs,
  session,
  creditsLabel,
  primaryLabel,
  secondaryLabel,
  subscriptionPeriodEndMs,
}: {
  activeWorkspacePlanLabel: string;
  creditUsage: CreditUsage | null | undefined;
  currentTimestampMs: number;
  creditsLabel: string | undefined;
  primaryLabel: string | undefined;
  secondaryLabel: string | undefined;
  session: Session;
  subscriptionPeriodEndMs: number | null | undefined;
}) {
  const members = await userService.getMyMembersWithOrganizations();
  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  const workspacePlanLabels = await getWorkspacePlanLabels(
    members,
    activeOrganizationId,
  );
  const activeWorkspaceKey = activeOrganizationId ?? PERSONAL_WORKSPACE_KEY;
  const workspacePlanLabelsWithActive = {
    ...workspacePlanLabels,
    [activeWorkspaceKey]: activeWorkspacePlanLabel,
  };

  return (
    <UserAvatarClient
      sessionUser={session.user}
      members={members}
      activeOrganizationId={activeOrganizationId}
      creditUsage={creditUsage}
      currentTimestampMs={currentTimestampMs}
      creditsLabel={creditsLabel}
      primaryLabel={primaryLabel}
      secondaryLabel={secondaryLabel}
      workspacePlanLabels={workspacePlanLabelsWithActive}
      subscriptionPeriodEndMs={subscriptionPeriodEndMs}
    />
  );
}
