import {
  EnterpriseContractPeriodStatus,
  EnterpriseContractStatus,
  type Prisma,
} from "../generated/prisma/client.js";
import { ENTERPRISE_CONTRACT_PRECREATE_LOOKAHEAD_MS } from "./enterprise-contract.js";
import {
  findEnterprisePeriodCreditBucket,
  type GrantEnterpriseCredits,
} from "./enterprise-contract-grants.js";
import { completeEnterpriseContractsAfterLastPeriod } from "./enterprise-contract-lifecycle.js";

const activeContractWhere = {
  status: EnterpriseContractStatus.active,
} as const;

const scheduledPeriodInclude = {
  contract: {
    select: {
      organizationId: true,
    },
  },
} as const;

type ScheduledEnterprisePeriod = Prisma.EnterpriseContractPeriodGetPayload<{
  include: typeof scheduledPeriodInclude;
}>;

interface EnterpriseContractSchedulerPassResult {
  catchUpGranted: number;
  completedContracts: number;
  expiredPeriods: number;
  preCreated: number;
}

interface GrantEnterpriseScheduledPeriodResult {
  bucketCreated: boolean;
  periodActivated: boolean;
}

export function resolveCatchUpActivatesAt(
  period: Pick<ScheduledEnterprisePeriod, "periodEnd" | "periodStart">,
  now: Date,
): Date {
  if (now.getTime() > period.periodEnd.getTime()) {
    return period.periodStart;
  }

  return now;
}

function isCatchUpPeriodElapsed(
  period: Pick<ScheduledEnterprisePeriod, "periodEnd">,
  now: Date,
): boolean {
  return now.getTime() > period.periodEnd.getTime();
}

export async function grantEnterpriseScheduledPeriod(
  period: ScheduledEnterprisePeriod,
  activatesAt: Date,
  tx: Prisma.TransactionClient,
  grantCredits: GrantEnterpriseCredits,
  now?: Date,
): Promise<GrantEnterpriseScheduledPeriodResult> {
  const existingBucket = await findEnterprisePeriodCreditBucket(period.id, tx);

  let bucketCreated = false;
  if (!existingBucket) {
    const { outcome } = await grantCredits({
      kind: "enterprise_period",
      activatesAt,
      cents: period.centsToGrant,
      expiresAt: period.periodEnd,
      organizationId: period.contract.organizationId,
      periodId: period.id,
    });
    bucketCreated = outcome === "granted";
  }

  let periodActivated = false;
  if (period.status === EnterpriseContractPeriodStatus.scheduled) {
    const nextStatus =
      now != null && isCatchUpPeriodElapsed(period, now)
        ? EnterpriseContractPeriodStatus.expired
        : EnterpriseContractPeriodStatus.active;

    await tx.enterpriseContractPeriod.update({
      where: {
        id: period.id,
      },
      data: {
        status: nextStatus,
      },
    });
    periodActivated = true;
  }

  return {
    bucketCreated,
    periodActivated,
  };
}

export async function expireActiveEnterprisePeriodsWithElapsedBuckets(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<number> {
  const activePeriods = await tx.enterpriseContractPeriod.findMany({
    where: {
      status: EnterpriseContractPeriodStatus.active,
      contract: activeContractWhere,
    },
    select: {
      id: true,
    },
  });

  let expiredCount = 0;

  for (const period of activePeriods) {
    const bucket = await findEnterprisePeriodCreditBucket(period.id, tx);
    if (!bucket?.expiresAt) {
      continue;
    }

    if (bucket.expiresAt.getTime() > now.getTime()) {
      continue;
    }

    await tx.enterpriseContractPeriod.update({
      where: {
        id: period.id,
      },
      data: {
        status: EnterpriseContractPeriodStatus.expired,
      },
    });
    expiredCount += 1;
  }

  return expiredCount;
}

export async function catchUpScheduledEnterprisePeriods(
  tx: Prisma.TransactionClient,
  grantCredits: GrantEnterpriseCredits,
  now: Date = new Date(),
): Promise<number> {
  const duePeriods = await tx.enterpriseContractPeriod.findMany({
    where: {
      status: EnterpriseContractPeriodStatus.scheduled,
      periodStart: {
        lte: now,
      },
      contract: activeContractWhere,
    },
    include: scheduledPeriodInclude,
    orderBy: [{ periodStart: "asc" }, { id: "asc" }],
  });

  let catchUpGranted = 0;

  for (const period of duePeriods) {
    const activatesAt = resolveCatchUpActivatesAt(period, now);
    const result = await grantEnterpriseScheduledPeriod(
      period,
      activatesAt,
      tx,
      grantCredits,
      now,
    );
    if (result.bucketCreated || result.periodActivated) {
      catchUpGranted += 1;
    }
  }

  return catchUpGranted;
}

export async function preCreateUpcomingEnterprisePeriods(
  tx: Prisma.TransactionClient,
  grantCredits: GrantEnterpriseCredits,
  now: Date = new Date(),
): Promise<number> {
  const lookaheadEnd = new Date(
    now.getTime() + ENTERPRISE_CONTRACT_PRECREATE_LOOKAHEAD_MS,
  );

  const upcomingPeriods = await tx.enterpriseContractPeriod.findMany({
    where: {
      status: EnterpriseContractPeriodStatus.scheduled,
      periodStart: {
        gt: now,
        lte: lookaheadEnd,
      },
      contract: activeContractWhere,
    },
    include: scheduledPeriodInclude,
    orderBy: [{ periodStart: "asc" }, { id: "asc" }],
  });

  let preCreated = 0;

  for (const period of upcomingPeriods) {
    const result = await grantEnterpriseScheduledPeriod(
      period,
      period.periodStart,
      tx,
      grantCredits,
    );
    if (result.bucketCreated || result.periodActivated) {
      preCreated += 1;
    }
  }

  return preCreated;
}

export async function runEnterpriseContractSchedulerPass(
  tx: Prisma.TransactionClient,
  grantCredits: GrantEnterpriseCredits,
  now: Date = new Date(),
): Promise<EnterpriseContractSchedulerPassResult> {
  const expiredPeriods = await expireActiveEnterprisePeriodsWithElapsedBuckets(
    tx,
    now,
  );
  const catchUpGranted = await catchUpScheduledEnterprisePeriods(
    tx,
    grantCredits,
    now,
  );
  const preCreated = await preCreateUpcomingEnterprisePeriods(
    tx,
    grantCredits,
    now,
  );
  const completedContracts = await completeEnterpriseContractsAfterLastPeriod(
    tx,
    now,
  );

  return {
    catchUpGranted,
    completedContracts,
    expiredPeriods,
    preCreated,
  };
}
