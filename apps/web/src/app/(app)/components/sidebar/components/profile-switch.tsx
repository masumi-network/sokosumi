import type { MemberWithOrganization } from "@sokosumi/database";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import type { Session } from "@/lib/auth/auth";
import { coreClient } from "@/lib/clients/core.client";
import { userService } from "@/lib/services";

import ProfileSwitchClient from "./profile-switch.client";

interface ProfileSwitchProps {
  session: Session;
}

function ProfileSwitchSkeleton() {
  return (
    <div className="px-4 py-2.5">
      <div className="bg-muted h-10 w-full animate-pulse rounded-md" />
    </div>
  );
}

export default function ProfileSwitch({ session }: ProfileSwitchProps) {
  return (
    <Suspense fallback={<ProfileSwitchSkeleton />}>
      <ProfileSwitchInner session={session} />
    </Suspense>
  );
}

async function ProfileSwitchInner({ session }: ProfileSwitchProps) {
  const tCredit = await getTranslations("App.Header.Credit");
  const tPlan = await getTranslations("App.Header.Plan");
  const tSubscriptions = await getTranslations("App.Subscriptions");
  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  const hasActiveOrganization = activeOrganizationId !== null;

  let members: MemberWithOrganization[] = [];
  let currentPlan: string | null = null;
  let activeOrganizationName: string | null = null;

  try {
    const [membersResult, creditsResult, organizationsResult] =
      await Promise.allSettled([
        userService.getMyMembersWithOrganizations(),
        coreClient.getMyCredits(),
        activeOrganizationId ? coreClient.getMyOrganizations() : null,
      ]);

    if (membersResult.status === "fulfilled") {
      members = membersResult.value;
    }

    if (creditsResult.status === "fulfilled") {
      currentPlan = creditsResult.value.data.subscription?.plan ?? "free";
    }

    if (
      activeOrganizationId &&
      organizationsResult.status === "fulfilled" &&
      organizationsResult.value?.data
    ) {
      const foundOrganization = organizationsResult.value.data.find(
        (organization) => organization.id === activeOrganizationId,
      );

      if (foundOrganization) {
        activeOrganizationName = foundOrganization.name;
      }
    }
  } catch (_error) {
    members = [];
    currentPlan = null;
  }

  let secondaryLabel = tPlan("unavailable");
  if (currentPlan !== null) {
    try {
      const planName = tSubscriptions(`Plans.${currentPlan}.name`);
      secondaryLabel = hasActiveOrganization
        ? tPlan("organizationPlan", {
            plan: planName,
            organization: activeOrganizationName ?? tCredit("unavailable"),
          })
        : tPlan("userPlan", { plan: planName });
    } catch (_error) {
      secondaryLabel = tPlan("unavailable");
    }
  }

  return (
    <ProfileSwitchClient
      sessionUser={session.user}
      members={members}
      activeOrganizationId={activeOrganizationId}
      secondaryLabel={secondaryLabel}
    />
  );
}
