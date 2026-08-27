import type { Prisma } from "@sokosumi/database";
import {
  ensureLocalFreeSubscriptionPeriod,
  fetchOrganizationMemberUserIds,
  isActiveSubscriptionStatus,
  resolveOrganizationBillingPlan,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import { badRequest, notFound } from "@/helpers/error";

/**
 * Maps member-repository seat errors to HTTP exceptions; rethrows everything
 * else (including HTTP exceptions thrown by guards inside the transaction).
 */
export function mapSeatRepositoryError(error: unknown): never {
  if (error instanceof HTTPException || !(error instanceof Error)) {
    throw error;
  }

  if (error.message === "Member not found") {
    throw notFound("Member not found", {
      kind: CORE_API_ERROR_KINDS.MEMBER_NOT_FOUND,
    });
  }

  if (error.message.includes("exceeds purchased seats")) {
    throw badRequest(
      "No unused seats available. Purchase more seats or unassign another member.",
      { kind: CORE_API_ERROR_KINDS.SEAT_CAPACITY_EXCEEDED },
    );
  }

  throw error;
}

export async function unassignOrganizationMemberSeatWithCreditSync(
  organizationId: string,
  memberId: string,
  tx: Prisma.TransactionClient,
): Promise<{ memberId: string }> {
  const billingPlan = await resolveOrganizationBillingPlan(organizationId, tx);
  const member = await memberRepository.unassignSeat(
    memberId,
    organizationId,
    tx,
  );

  if (billingPlan.mode === "enterprise_contract" && billingPlan.isConsumable) {
    return {
      memberId: member.id,
    };
  }

  const subscription =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      organizationId,
      tx,
    );

  if (
    subscription?.periodStart &&
    subscription.periodEnd &&
    !subscription.stripeSubscriptionId
  ) {
    await syncLocalFreeOrganizationCreditsIfNeeded(
      organizationId,
      {
        createdAt: subscription.createdAt,
        periodEnd: subscription.periodEnd,
        periodStart: subscription.periodStart,
        seats: subscription.seats,
        status: subscription.status,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      },
      tx,
    );
  }

  return {
    memberId: member.id,
  };
}

export async function syncLocalFreeOrganizationCreditsIfNeeded(
  organizationId: string,
  subscription: {
    createdAt: Date;
    periodEnd: Date;
    periodStart: Date;
    seats: number | null;
    status: string;
    stripeSubscriptionId: string | null;
  },
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (
    subscription.stripeSubscriptionId ||
    !isActiveSubscriptionStatus(subscription.status)
  ) {
    return;
  }

  const memberUserIds = await fetchOrganizationMemberUserIds(
    organizationId,
    tx,
  );

  await ensureLocalFreeSubscriptionPeriod(
    {
      billingAnchorDate: subscription.createdAt,
      memberUserIds,
      organizationId,
      periodEnd: subscription.periodEnd,
      periodStart: subscription.periodStart,
      purchasedSeats: resolvePurchasedSeats(subscription.seats),
      referenceId: organizationId,
    },
    tx,
  );
}
