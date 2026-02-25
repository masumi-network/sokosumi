import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import {
  convertCentsToCredits,
  getOrganizationMemberSubscriptionReferencePrefix,
} from "@sokosumi/database/helpers";

type MemberWithOrganization = {
  organization: {
    id: string;
  };
  role: string;
};

export async function attachCreditsToOrganizations(
  members: MemberWithOrganization[],
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<
  Array<
    MemberWithOrganization["organization"] & {
      role: string;
      credits: number;
    }
  >
> {
  if (members.length === 0) {
    return [];
  }

  const organizationIds = members.map((member) => member.organization.id);
  const now = new Date();
  const memberReferencePattern = `${getOrganizationMemberSubscriptionReferencePrefix(userId)}%`;
  const rows = await tx.$queryRaw<
    Array<{ organization_id: string; balance: bigint }>
  >`
    WITH bucket_avail AS (
      SELECT
        cb."organizationId" AS organization_id,
        (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS available
      FROM credit_bucket cb
      LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
      WHERE cb."organizationId" = ANY(${organizationIds})
        AND (
          cb."referenceType" IS DISTINCT FROM ${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}
          OR (
            cb."referenceType" = ${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}
            AND cb."userId" = ${userId}
            AND cb."referenceId" LIKE ${memberReferencePattern}
          )
        )
        AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
      GROUP BY cb."organizationId", cb.id, cb.amount
    )
    SELECT organization_id, COALESCE(SUM(available), 0)::bigint AS balance
    FROM bucket_avail
    GROUP BY organization_id
  `;

  const balances = new Map(
    rows.map((row) => [row.organization_id, row.balance]),
  );

  return members.map((member) => ({
    ...member.organization,
    role: member.role,
    credits: convertCentsToCredits(balances.get(member.organization.id) ?? 0n),
  }));
}
