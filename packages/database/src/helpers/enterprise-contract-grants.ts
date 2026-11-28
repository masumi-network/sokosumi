import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import { netTable, netType, type TableNetwork } from "../sql-tables.js";
import {
  findCreditBucketByReference,
  insertCreditGrant,
} from "./credit-grant-sql.js";

function buildEnterprisePeriodCreditReferenceId(periodId: string): string {
  return periodId;
}

function buildEnterpriseTopUpCreditReferenceId(contractId: string): string {
  return contractId;
}

/**
 * An enterprise contract's credits for a period or its top-up: once per
 * period or contract id. A period always expires; a top-up may not.
 */
export type EnterpriseCredits = {
  organizationId: string;
  cents: bigint;
  activatesAt: Date;
} & (
  | { kind: "enterprise_period"; periodId: string; expiresAt: Date }
  | {
      kind: "enterprise_top_up";
      contractId: string;
      /** Null never expires. */
      expiresAt: Date | null;
    }
);

/**
 * Gives a contract's credits on the caller's transaction: Core's credits
 * module (`grant`), which writes them with the bucket writers below.
 */
export type GrantEnterpriseCredits = (
  credits: EnterpriseCredits,
) => Promise<{ outcome: "granted" | "already_granted"; bucketId: string }>;

/**
 * Expires a contract's credits now, on the caller's transaction: Core's
 * credits module (`expireEnterpriseGrants`), which writes it with
 * `expireCreditBucketsNow`. Answers how many buckets it expired.
 */
export type ExpireEnterpriseCredits = (contract: {
  periodIds: string[];
  /** The contract's id when it has a top-up, else null. */
  topUpContractId: string | null;
  now: Date;
}) => Promise<number>;

interface CreateEnterprisePeriodCreditBucketParams {
  activatesAt: Date;
  amount: bigint;
  expiresAt: Date;
  mintId?: () => string;
  network?: TableNetwork;
  organizationId: string;
  periodId: string;
}

interface CreateEnterprisePeriodCreditBucketResult {
  bucketId: string;
  created: boolean;
}

export async function createEnterprisePeriodCreditBucket(
  params: CreateEnterprisePeriodCreditBucketParams,
  tx: Prisma.TransactionClient,
): Promise<CreateEnterprisePeriodCreditBucketResult> {
  const network = params.network ?? "mainnet";
  const referenceId = buildEnterprisePeriodCreditReferenceId(params.periodId);
  const existingBucket = await findCreditBucketByReference(
    {
      network,
      referenceId,
      referenceType: CreditBucketReferenceType.ENTERPRISE_PERIOD,
    },
    tx,
  );

  if (existingBucket) {
    return { bucketId: existingBucket.id, created: false };
  }

  const { bucketId } = await insertCreditGrant(
    {
      mintId: params.mintId,
      network,
      activatesAt: params.activatesAt,
      amount: params.amount,
      expiresAt: params.expiresAt,
      organizationId: params.organizationId,
      referenceId,
      referenceType: CreditBucketReferenceType.ENTERPRISE_PERIOD,
      userId: null,
    },
    tx,
  );

  return { bucketId, created: true };
}

interface CreateEnterpriseTopUpCreditBucketParams {
  activatesAt: Date;
  amount: bigint;
  contractId: string;
  expiresAt: Date | null;
  mintId?: () => string;
  network?: TableNetwork;
  organizationId: string;
}

interface CreateEnterpriseTopUpCreditBucketResult {
  bucketId: string;
  created: boolean;
}

export async function createEnterpriseTopUpCreditBucket(
  params: CreateEnterpriseTopUpCreditBucketParams,
  tx: Prisma.TransactionClient,
): Promise<CreateEnterpriseTopUpCreditBucketResult> {
  const network = params.network ?? "mainnet";
  const referenceId = buildEnterpriseTopUpCreditReferenceId(params.contractId);
  const existingBucket = await findCreditBucketByReference(
    {
      network,
      referenceId,
      referenceType: CreditBucketReferenceType.ENTERPRISE_TOP_UP,
    },
    tx,
  );

  if (existingBucket) {
    return { bucketId: existingBucket.id, created: false };
  }

  const { bucketId } = await insertCreditGrant(
    {
      mintId: params.mintId,
      network,
      activatesAt: params.activatesAt,
      amount: params.amount,
      expiresAt: params.expiresAt,
      organizationId: params.organizationId,
      referenceId,
      referenceType: CreditBucketReferenceType.ENTERPRISE_TOP_UP,
      userId: null,
    },
    tx,
  );

  return { bucketId, created: true };
}

export async function expireCreditBucketsNow(
  params: {
    network?: TableNetwork;
    now?: Date;
    referenceIds: string[];
    referenceTypes: CreditBucketReferenceType[];
  },
  tx: Prisma.TransactionClient,
): Promise<number> {
  if (params.referenceIds.length === 0 || params.referenceTypes.length === 0) {
    return 0;
  }

  const network = params.network ?? "mainnet";
  const now = params.now ?? new Date();
  const updatedAt = new Date();
  return await tx.$executeRaw`
    UPDATE ${netTable(network, "credit_bucket")}
    SET "expiresAt" = ${now}, "updatedAt" = ${updatedAt}
    WHERE "referenceId" = ANY(${params.referenceIds}::text[])
      AND "referenceType" = ANY(CAST(${params.referenceTypes}::text[] AS ${netType(network, "CreditBucketReferenceType")}[]))
      AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
  `;
}

export async function findEnterprisePeriodCreditBucket(
  periodId: string,
  tx: Prisma.TransactionClient,
  network: TableNetwork = "mainnet",
): Promise<{
  activatesAt: Date | null;
  expiresAt: Date | null;
  id: string;
} | null> {
  return await findCreditBucketByReference(
    {
      network,
      referenceId: buildEnterprisePeriodCreditReferenceId(periodId),
      referenceType: CreditBucketReferenceType.ENTERPRISE_PERIOD,
    },
    tx,
  );
}
