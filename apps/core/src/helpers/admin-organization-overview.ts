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
import pLimit from "p-limit";

import { getEnterpriseContractBillingSummary } from "@/helpers/enterprise-contract-summary.js";
import { buildCreditsPayload } from "@/helpers/subscription.js";

const ADMIN_ORGANIZATION_MEMBER_CREDITS_CONCURRENCY = 5;

export async function listAdminExternalChannels(
  organizationId: string,
  tx: Prisma.TransactionClient,
) {
  const rooms = await tx.chatRoom.findMany({
    where: {
      organizationId,
      kind: "channel",
      discoverability: "external",
      archivedAt: null,
    },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });

  return rooms.flatMap((room) =>
    room.slug ? [{ id: room.id, name: room.name, slug: room.slug }] : [],
  );
}

type AdminOrganizationMemberRecord = Awaited<
  ReturnType<typeof memberRepository.getMembersWithUserAndLastSeen>
>[number];

interface AdminOrganizationBillingSnapshot {
  mode: "enterprise_contract" | "self_serve";
  plan: "free" | "starter" | "standard" | "pro" | "enterprise";
  isConsumable: boolean;
  purchasedSeats: number;
  cancelAtPeriodEnd: boolean;
  periodEnd: Date | null;
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

export async function buildAdminOrganizationMemberOverviewItem(
  member: AdminOrganizationMemberRecord,
  organizationId: string,
  tx: Prisma.TransactionClient,
) {
  const payload = await buildCreditsPayload({
    userId: member.userId,
    organizationId,
    referenceId: organizationId,
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
}

export async function buildAdminOrganizationMemberOverviewPage(
  slug: string,
  pagination: {
    cursor?: string;
    take: number;
    skip?: number;
  },
  tx: Prisma.TransactionClient,
) {
  const organization =
    await organizationRepository.getOrganizationLimitedInfoBySlug(slug, tx);

  if (!organization) {
    return null;
  }

  const { members, total } = await memberRepository.listMembersForAdminOverview(
    {
      organizationId: organization.id,
      ...pagination,
    },
    tx,
  );

  const limit = pLimit(ADMIN_ORGANIZATION_MEMBER_CREDITS_CONCURRENCY);
  const items = await Promise.all(
    members.map((member) =>
      limit(() =>
        buildAdminOrganizationMemberOverviewItem(member, organization.id, tx),
      ),
    ),
  );

  return {
    members: items,
    total,
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
  const [assignedCount, subscription, externalChannels] = await Promise.all([
    memberRepository.getAssignedMemberCount(organization.id, tx),
    billingPlan.mode === "self_serve"
      ? subscriptionRepository.resolveActiveSubscriptionByReferenceId(
          organization.id,
          tx,
        )
      : Promise.resolve(null),
    listAdminExternalChannels(organization.id, tx),
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

  const totalCredits =
    billingPlan.mode === "enterprise_contract"
      ? (enterpriseContract?.poolRemainingCredits ?? 0)
      : null;

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
    externalChannels,
  };
}

export async function getAdminOrganizationBySlug(
  slug: string,
  tx: Prisma.TransactionClient,
) {
  return organizationRepository.getOrganizationLimitedInfoBySlug(slug, tx);
}
