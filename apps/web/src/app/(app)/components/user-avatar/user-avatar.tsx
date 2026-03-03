import { Suspense } from "react";

import { Session } from "@/lib/auth/auth";
import { userService } from "@/lib/services";
import { CreditUsage } from "@/lib/types/credit";

import UserAvatarClient from "./user-avatar.client";
import UserAvatarSkeleton from "./user-avatar-skeleton";

interface UserAvatarProps {
  creditUsage?: CreditUsage | null;
  currentTimestampMs: number;
  creditsLabel?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  session: Session;
  subscriptionPeriodEndMs?: number | null;
}

export default async function UserAvatar({
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
  creditUsage,
  currentTimestampMs,
  session,
  creditsLabel,
  primaryLabel,
  secondaryLabel,
  subscriptionPeriodEndMs,
}: {
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
      subscriptionPeriodEndMs={subscriptionPeriodEndMs}
    />
  );
}
