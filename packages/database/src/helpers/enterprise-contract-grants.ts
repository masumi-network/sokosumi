import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";

export function buildEnterprisePeriodCreditReferenceId(
  periodId: string,
): string {
  return periodId;
}

export function buildEnterpriseTopUpCreditReferenceId(
  contractId: string,
): string {
  return contractId;
}

export interface CreateEnterprisePeriodCreditBucketParams {
  activatesAt: Date;
  amount: bigint;
  expiresAt: Date;
  organizationId: string;
  periodId: string;
}

export interface CreateEnterprisePeriodCreditBucketResult {
  bucketId: string;
  created: boolean;
}

export async function createEnterprisePeriodCreditBucket(
  params: CreateEnterprisePeriodCreditBucketParams,
  tx: Prisma.TransactionClient,
): Promise<CreateEnterprisePeriodCreditBucketResult> {
  const referenceId = buildEnterprisePeriodCreditReferenceId(params.periodId);
  const existingBucket = await tx.creditBucket.findUnique({
    where: {
      referenceId_referenceType: {
        referenceId,
        referenceType: CreditBucketReferenceType.ENTERPRISE_PERIOD,
      },
    },
    select: { id: true },
  });

  if (existingBucket) {
    return { bucketId: existingBucket.id, created: false };
  }

  const transaction = await tx.transaction.create({
    data: {
      amount: params.amount,
      organizationId: params.organizationId,
      userId: null,
      sourceCreditBucket: {
        create: {
          activatesAt: params.activatesAt,
          amount: params.amount,
          expiresAt: params.expiresAt,
          organizationId: params.organizationId,
          referenceId,
          referenceType: CreditBucketReferenceType.ENTERPRISE_PERIOD,
          userId: null,
        },
      },
    },
    select: {
      sourceCreditBucket: {
        select: { id: true },
      },
    },
  });

  const bucketId = transaction.sourceCreditBucket?.id;
  if (!bucketId) {
    throw new Error("Failed to create enterprise period credit bucket");
  }

  return { bucketId, created: true };
}

export interface CreateEnterpriseTopUpCreditBucketParams {
  activatesAt: Date;
  amount: bigint;
  contractId: string;
  expiresAt: Date | null;
  organizationId: string;
}

export interface CreateEnterpriseTopUpCreditBucketResult {
  bucketId: string;
  created: boolean;
}

export async function createEnterpriseTopUpCreditBucket(
  params: CreateEnterpriseTopUpCreditBucketParams,
  tx: Prisma.TransactionClient,
): Promise<CreateEnterpriseTopUpCreditBucketResult> {
  const referenceId = buildEnterpriseTopUpCreditReferenceId(params.contractId);
  const existingBucket = await tx.creditBucket.findUnique({
    where: {
      referenceId_referenceType: {
        referenceId,
        referenceType: CreditBucketReferenceType.ENTERPRISE_TOP_UP,
      },
    },
    select: { id: true },
  });

  if (existingBucket) {
    return { bucketId: existingBucket.id, created: false };
  }

  const transaction = await tx.transaction.create({
    data: {
      amount: params.amount,
      organizationId: params.organizationId,
      userId: null,
      sourceCreditBucket: {
        create: {
          activatesAt: params.activatesAt,
          amount: params.amount,
          expiresAt: params.expiresAt,
          organizationId: params.organizationId,
          referenceId,
          referenceType: CreditBucketReferenceType.ENTERPRISE_TOP_UP,
          userId: null,
        },
      },
    },
    select: {
      sourceCreditBucket: {
        select: { id: true },
      },
    },
  });

  const bucketId = transaction.sourceCreditBucket?.id;
  if (!bucketId) {
    throw new Error("Failed to create enterprise top-up credit bucket");
  }

  return { bucketId, created: true };
}

export async function expireCreditBucketsNow(
  params: {
    now?: Date;
    referenceIds: string[];
    referenceTypes: CreditBucketReferenceType[];
  },
  tx: Prisma.TransactionClient,
): Promise<number> {
  if (params.referenceIds.length === 0 || params.referenceTypes.length === 0) {
    return 0;
  }

  const now = params.now ?? new Date();
  const result = await tx.creditBucket.updateMany({
    where: {
      referenceId: {
        in: params.referenceIds,
      },
      referenceType: {
        in: params.referenceTypes,
      },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    data: {
      expiresAt: now,
    },
  });

  return result.count;
}

export async function findEnterprisePeriodCreditBucket(
  periodId: string,
  tx: Prisma.TransactionClient,
): Promise<{
  activatesAt: Date | null;
  expiresAt: Date | null;
  id: string;
} | null> {
  return await tx.creditBucket.findUnique({
    where: {
      referenceId_referenceType: {
        referenceId: buildEnterprisePeriodCreditReferenceId(periodId),
        referenceType: CreditBucketReferenceType.ENTERPRISE_PERIOD,
      },
    },
    select: {
      activatesAt: true,
      expiresAt: true,
      id: true,
    },
  });
}
