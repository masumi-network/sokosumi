import { MemberWithOrganization } from "@sokosumi/database";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { auth, Session } from "@/lib/auth/auth";
import {
  type ActiveSubscription,
  getPlanTranslationKey,
  resolveCurrentPlanName,
} from "@/lib/helpers/subscription";
import { userService } from "@/lib/services";

import UserAvatarClient from "./user-avatar.client";
import UserAvatarSkeleton from "./user-avatar-skeleton";

interface UserAvatarProps {
  creditsLabel?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  session: Session;
}

const PERSONAL_WORKSPACE_KEY = "personal-account";

async function getWorkspacePlanLabels(
  members: MemberWithOrganization[],
): Promise<Record<string, string>> {
  const requestHeaders = await headers();
  const tPlan = await getTranslations("App.Header.Plan");
  const tSubscriptions = await getTranslations("App.Subscriptions");
  const unavailablePlanLabel = tPlan("unavailable");

  const workspacePlanEntries = await Promise.all([
    (async () => {
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
        const planName = tSubscriptions(
          `Plans.${getPlanTranslationKey(currentPlan)}.name`,
        );

        return [PERSONAL_WORKSPACE_KEY, planName] as const;
      } catch (_error) {
        return [PERSONAL_WORKSPACE_KEY, unavailablePlanLabel] as const;
      }
    })(),
    ...members.map(async (member) => {
      try {
        const activeSubscriptions = await auth.api.listActiveSubscriptions({
          headers: requestHeaders,
          query: {
            customerType: "organization",
            referenceId: member.organization.id,
          },
        });

        const currentPlan =
          resolveCurrentPlanName(activeSubscriptions as ActiveSubscription[]) ??
          "free";
        const planName = tSubscriptions(
          `Plans.${getPlanTranslationKey(currentPlan)}.name`,
        );

        return [member.organization.id, planName] as const;
      } catch (_error) {
        return [member.organization.id, unavailablePlanLabel] as const;
      }
    }),
  ]);

  return Object.fromEntries(workspacePlanEntries);
}

export default async function UserAvatar({
  creditsLabel,
  primaryLabel,
  secondaryLabel,
  session,
}: UserAvatarProps) {
  return (
    <Suspense fallback={<UserAvatarSkeleton />}>
      <UserAvatarInner
        session={session}
        creditsLabel={creditsLabel}
        primaryLabel={primaryLabel}
        secondaryLabel={secondaryLabel}
      />
    </Suspense>
  );
}

async function UserAvatarInner({
  session,
  creditsLabel,
  primaryLabel,
  secondaryLabel,
}: {
  creditsLabel: string | undefined;
  primaryLabel: string | undefined;
  secondaryLabel: string | undefined;
  session: Session;
}) {
  const members = await userService.getMyMembersWithOrganizations();
  const workspacePlanLabels = await getWorkspacePlanLabels(members);

  return (
    <UserAvatarClient
      sessionUser={session.user}
      members={members}
      activeOrganizationId={session.session.activeOrganizationId ?? null}
      creditsLabel={creditsLabel}
      primaryLabel={primaryLabel}
      secondaryLabel={secondaryLabel}
      workspacePlanLabels={workspacePlanLabels}
    />
  );
}
