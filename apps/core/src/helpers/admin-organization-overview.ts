import type { Prisma } from "@sokosumi/database";
import {
  getUnusedSeatCount,
  resolveOrganizationBillingPlan,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  organizationRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";

import { getEnterpriseContractBillingSummary } from "@/helpers/enterprise-contract-summary.js";
import { buildCreditsPayload } from "@/helpers/subscription.js";

interface AdminOrganizationBillingSnapshot {
  mode: "enterprise_contract" | "self_serve";
  plan: "free" | "starter" | "standard" | "pro" | "enterprise";
  isConsumable: boolean;
  purchasedSeats: number;
  cancelAtPeriodEnd: boolean;
  periodEnd: Date | null;
}

async function resolveOrganizationTotalCredits(
  organizationId: string,
  billingPlan: Awaited<ReturnType<typeof resolveOrganizationBillingPlan>>,
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<number> {
  if (billingPlan.mode === "enterprise_contract") {
    const summary = await getEnterpriseContractBillingSummary(
      billingPlan,
      organizationId,
      tx,
      now,
    );
    return summary?.poolRemainingCredits ?? 0;
  }

  const members = await memberRepository.getMembersByOrganizationId(
    organizationId,
    tx,
  );
  if (members.length === 0) {
    return 0;
  }

  const creditsByMember = await Promise.all(
    members.map(async (member) => {
      const payload = await buildCreditsPayload({
        userId: member.userId,
        organizationId,
        referenceId: organizationId,
        tx,
      });
      return payload.credits.total;
    }),
  );

  return creditsByMember.reduce((sum, credits) => sum + credits, 0);
}

function mapBillingPlan(
  billingPlan: Awaited<ReturnType<typeof resolveOrganizationBillingPlan>>,
): AdminOrganizationBillingSnapshot {
  return {
    mode: billingPlan.mode,
    plan: billingPlan.plan,
    isConsumable:
      billingPlan.mode === "enterprise_contract"
        ? billingPlan.isConsumable
        : false,
    purchasedSeats: billingPlan.purchasedSeats,
    cancelAtPeriodEnd: billingPlan.cancelAtPeriodEnd,
    periodEnd: billingPlan.periodEnd,
  };
}

export async function buildAdminOrganizationOverviewItem(
  organization: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    _count: { members: number };
  },
  tx: Prisma.TransactionClient,
  now = new Date(),
) {
  const billingPlan = await resolveOrganizationBillingPlan(
    organization.id,
    tx,
    now,
  );
  const subscription =
    billingPlan.mode === "self_serve"
      ? await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
          organization.id,
          tx,
        )
      : null;
  const totalCredits = await resolveOrganizationTotalCredits(
    organization.id,
    billingPlan,
    tx,
    now,
  );

  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt: organization.createdAt,
    memberCount: organization._count.members,
    billingMode: billingPlan.mode,
    billingPlan: billingPlan.plan,
    purchasedSeats: billingPlan.purchasedSeats,
    subscriptionPlan: subscription?.plan ?? null,
    subscriptionStatus: subscription?.status ?? null,
    totalCredits,
  };
}

export async function buildAdminOrganizationOverviewDetail(
  slug: string,
  tx: Prisma.TransactionClient,
  now = new Date(),
) {
  const organization =
    await organizationRepository.getUniqueOrganizationWithRelations(
      { slug },
      tx,
    );

  if (!organization) {
    return null;
  }

  const billingPlan = await resolveOrganizationBillingPlan(
    organization.id,
    tx,
    now,
  );
  const [members, assignedCount, subscription, totalCredits] =
    await Promise.all([
      memberRepository.getMembersWithUserAndLastSeen(organization.id, tx),
      memberRepository.getAssignedMemberCount(organization.id, tx),
      billingPlan.mode === "self_serve"
        ? subscriptionRepository.resolveActiveSubscriptionByReferenceId(
            organization.id,
            tx,
          )
        : Promise.resolve(null),
      resolveOrganizationTotalCredits(organization.id, billingPlan, tx, now),
    ]);

  const paidPlan = billingPlan.plan === "free" ? null : billingPlan.plan;
  const hasSeatEntitlements = paidPlan != null;
  const purchasedSeats = billingPlan.purchasedSeats;

  const enterpriseContract =
    billingPlan.mode === "enterprise_contract"
      ? await getEnterpriseContractBillingSummary(
          billingPlan,
          organization.id,
          tx,
          now,
        )
      : null;

  const memberOverviews = await Promise.all(
    members.map(async (member) => {
      const payload = await buildCreditsPayload({
        userId: member.userId,
        organizationId: organization.id,
        referenceId: organization.id,
        tx,
      });

      return {
        id: member.id,
        organizationId: member.organizationId,
        role: member.role,
        seatAssignedAt: member.seatAssignedAt,
        createdAt: member.createdAt,
        user: {
          id: member.user.id,
          name: member.user.name,
          email: member.user.email,
        },
        lastSeenAt: member.lastSeenAt,
        credits: payload.credits.total,
        subscriptionPlan: payload.credits.subscription?.plan ?? null,
        subscriptionStatus: payload.credits.subscription?.status ?? null,
      };
    }),
  );

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      stripeCustomerId: organization.stripeCustomerId,
    },
    billingPlan: mapBillingPlan(billingPlan),
    subscription: subscription
      ? {
          plan: subscription.plan,
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
          periodStart: subscription.periodStart,
          periodEnd: subscription.periodEnd,
          seats: subscription.seats,
        }
      : null,
    enterpriseContract: enterpriseContract
      ? {
          poolRemainingCredits: enterpriseContract.poolRemainingCredits,
          monthlyCredits: enterpriseContract.monthlyCredits,
          purchasedSeats: enterpriseContract.purchasedSeats,
          isConsumable: enterpriseContract.isConsumable,
        }
      : null,
    seatSummary: {
      assignedCount: hasSeatEntitlements ? assignedCount : 0,
      memberCount: organization._count.members,
      purchasedSeats,
      unusedSeats: hasSeatEntitlements
        ? getUnusedSeatCount(purchasedSeats, assignedCount)
        : 0,
      paidPlan,
      isEnterpriseContract: billingPlan.mode === "enterprise_contract",
    },
    totalCredits,
    members: memberOverviews,
  };
}

export async function getAdminOrganizationBySlug(
  slug: string,
  tx: Prisma.TransactionClient,
) {
  return organizationRepository.getOrganizationLimitedInfoBySlug(slug, tx);
}
