import type { MemberWithOrganization } from "@sokosumi/database";
import type { Session } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { coreClient } from "@/lib/clients/core.client";
import type {
  GetUsersByIdCreditsResponse,
  GetUsersByIdOrganizationsResponse,
} from "@/lib/clients/generated/core";
import { userService } from "@/lib/services";

import HeaderProfileSectionClient from "./header-profile-section.client";

interface HeaderProfileSectionProps {
  session: Session;
}

function HeaderProfileSectionSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col items-end gap-1">
        <div className="bg-muted h-4 w-28 animate-pulse rounded-md" />
        <div className="bg-muted h-3 w-36 animate-pulse rounded-md" />
      </div>
      <div className="bg-muted size-8 animate-pulse rounded-full" />
    </div>
  );
}

export default function HeaderProfileSection({
  session,
}: HeaderProfileSectionProps) {
  return (
    <Suspense fallback={<HeaderProfileSectionSkeleton />}>
      <HeaderProfileSectionInner session={session} />
    </Suspense>
  );
}

async function HeaderProfileSectionInner({
  session,
}: HeaderProfileSectionProps) {
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
        activeOrganizationId
          ? coreClient.getMyOrganizations()
          : Promise.resolve(null),
      ]);

    if (membersResult.status === "fulfilled") {
      members = membersResult.value;
    }

    if (creditsResult.status === "fulfilled") {
      const credits = creditsResult.value as GetUsersByIdCreditsResponse;
      currentPlan = credits.data.subscription?.plan ?? "free";
    }

    if (
      activeOrganizationId &&
      organizationsResult.status === "fulfilled" &&
      organizationsResult.value
    ) {
      const organizations =
        organizationsResult.value as GetUsersByIdOrganizationsResponse;
      const foundOrganization = organizations.data.find(
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
    <HeaderProfileSectionClient
      sessionUser={session.user}
      members={members}
      activeOrganizationId={activeOrganizationId}
      secondaryLabel={secondaryLabel}
    />
  );
}
