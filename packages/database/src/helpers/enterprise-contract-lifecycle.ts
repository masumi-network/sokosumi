import {
  CreditBucketReferenceType,
  EnterpriseContractPeriodStatus,
  EnterpriseContractStatus,
  type Prisma,
} from "../generated/prisma/client.js";
import {
  buildEnterpriseContractPeriodSchedule,
  isEnterpriseContractPastCommercialTerm,
  validateEnterprisePeriodCount,
} from "./enterprise-contract.js";
import {
  EnterpriseContractActivationError,
  EnterpriseContractLifecycleError,
  EnterpriseContractNotFoundError,
} from "./enterprise-contract-errors.js";
import { findPaidSubscriptionsBlockingEnterpriseActivation } from "./enterprise-contract-exclusivity.js";
import {
  createEnterprisePeriodCreditBucket,
  createEnterpriseTopUpCreditBucket,
  expireCreditBucketsNow,
  findEnterprisePeriodCreditBucket,
  resolveOrganizationGrantTransactionUserId,
} from "./enterprise-contract-grants.js";
import {
  autoAssignSeatsOnPaidSubscribe,
  unassignSeatsOverPurchasedCapacity,
} from "./organization-paid-subscribe-seats.js";

export {
  EnterpriseContractActivationError,
  EnterpriseContractLifecycleError,
  EnterpriseContractNotFoundError,
} from "./enterprise-contract-errors.js";

export interface ActivateEnterpriseContractParams {
  activatedAt: Date;
  paymentReference?: string | null;
}

export interface ActivateEnterpriseContractResult {
  contractId: string;
  periodBucketCreated: boolean;
  periodsCreated: number;
  topUpBucketCreated: boolean;
}

export async function activateEnterpriseContract(
  contractId: string,
  params: ActivateEnterpriseContractParams,
  tx: Prisma.TransactionClient,
): Promise<ActivateEnterpriseContractResult> {
  const contract = await tx.enterpriseContract.findUnique({
    where: { id: contractId },
    include: {
      periods: true,
    },
  });

  if (!contract) {
    throw new EnterpriseContractNotFoundError();
  }

  if (contract.status !== EnterpriseContractStatus.draft) {
    throw new EnterpriseContractLifecycleError(
      "Only draft enterprise contracts can be activated",
    );
  }

  await completeEnterpriseContractsAfterLastPeriod(tx, params.activatedAt, {
    organizationId: contract.organizationId,
  });

  const existingActiveContract = await tx.enterpriseContract.findFirst({
    where: {
      organizationId: contract.organizationId,
      status: EnterpriseContractStatus.active,
    },
    select: {
      id: true,
    },
  });

  if (existingActiveContract) {
    throw new EnterpriseContractLifecycleError(
      "Organization already has an active enterprise contract",
    );
  }

  validateEnterprisePeriodCount(contract.periodCount);

  const blocker = await findPaidSubscriptionsBlockingEnterpriseActivation(
    contract.organizationId,
    tx,
    params.activatedAt,
  );

  if (blocker) {
    throw new EnterpriseContractActivationError(blocker);
  }

  const activatedAt = params.activatedAt;
  const schedule = buildEnterpriseContractPeriodSchedule({
    activatedAt,
    centsPerMonth: contract.centsPerMonth,
    periodCount: contract.periodCount,
    purchasedSeats: contract.seats,
  });

  if (schedule.length !== contract.periodCount) {
    throw new EnterpriseContractLifecycleError(
      "Failed to build enterprise contract period schedule",
    );
  }

  if (contract.periods.length > 0) {
    await tx.enterpriseContractPeriod.deleteMany({
      where: {
        contractId,
      },
    });
  }

  const createdPeriods = await Promise.all(
    schedule.map((periodDraft) =>
      tx.enterpriseContractPeriod.create({
        data: {
          centsToGrant: periodDraft.centsToGrant,
          contractId,
          periodEnd: periodDraft.periodEnd,
          periodStart: periodDraft.periodStart,
          purchasedSeats: periodDraft.purchasedSeats,
          status: EnterpriseContractPeriodStatus.scheduled,
        },
      }),
    ),
  );

  const firstPeriod = createdPeriods[0];
  if (!firstPeriod) {
    throw new EnterpriseContractLifecycleError(
      "Enterprise contract schedule must include at least one period",
    );
  }

  const transactionUserId = await resolveOrganizationGrantTransactionUserId(
    contract.organizationId,
    tx,
  );

  const periodBucket = await createEnterprisePeriodCreditBucket(
    {
      activatesAt: activatedAt,
      amount: firstPeriod.centsToGrant,
      expiresAt: firstPeriod.periodEnd,
      organizationId: contract.organizationId,
      periodId: firstPeriod.id,
      transactionUserId,
    },
    tx,
  );

  await tx.enterpriseContractPeriod.update({
    where: {
      id: firstPeriod.id,
    },
    data: {
      status: EnterpriseContractPeriodStatus.active,
    },
  });

  let topUpBucketCreated = false;
  if (contract.oneTimeCents != null && contract.oneTimeCents > 0n) {
    const topUpBucket = await createEnterpriseTopUpCreditBucket(
      {
        activatesAt: activatedAt,
        amount: contract.oneTimeCents,
        contractId: contract.id,
        expiresAt: contract.oneTimeExpiresAt,
        organizationId: contract.organizationId,
        transactionUserId,
      },
      tx,
    );
    topUpBucketCreated = topUpBucket.created;
  }

  await tx.enterpriseContract.update({
    where: {
      id: contractId,
    },
    data: {
      activatedAt,
      paymentReference: params.paymentReference ?? contract.paymentReference,
      status: EnterpriseContractStatus.active,
    },
  });

  await autoAssignSeatsOnPaidSubscribe(
    contract.organizationId,
    contract.seats,
    tx,
  );
  await unassignSeatsOverPurchasedCapacity(
    contract.organizationId,
    contract.seats,
    tx,
  );

  return {
    contractId,
    periodBucketCreated: periodBucket.created,
    periodsCreated: createdPeriods.length,
    topUpBucketCreated,
  };
}

export async function cancelEnterpriseContract(
  contractId: string,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<void> {
  const contract = await tx.enterpriseContract.findUnique({
    where: { id: contractId },
    include: {
      periods: true,
    },
  });

  if (!contract) {
    throw new EnterpriseContractNotFoundError();
  }

  if (contract.status !== EnterpriseContractStatus.active) {
    throw new EnterpriseContractLifecycleError(
      "Only active enterprise contracts can be canceled",
    );
  }

  const referenceIds = contract.periods.map((period) => period.id);
  if (contract.oneTimeCents != null && contract.oneTimeCents > 0n) {
    referenceIds.push(contract.id);
  }

  await expireCreditBucketsNow(
    {
      now,
      referenceIds,
      referenceTypes: [
        CreditBucketReferenceType.ENTERPRISE_PERIOD,
        CreditBucketReferenceType.ENTERPRISE_TOP_UP,
      ],
    },
    tx,
  );

  await tx.enterpriseContractPeriod.updateMany({
    where: {
      contractId,
      status: EnterpriseContractPeriodStatus.scheduled,
    },
    data: {
      status: EnterpriseContractPeriodStatus.void,
    },
  });

  for (const period of contract.periods) {
    if (period.status !== EnterpriseContractPeriodStatus.active) {
      continue;
    }

    const bucket = await findEnterprisePeriodCreditBucket(period.id, tx);
    const isFutureActive =
      bucket?.activatesAt != null &&
      bucket.activatesAt.getTime() > now.getTime();

    await tx.enterpriseContractPeriod.update({
      where: {
        id: period.id,
      },
      data: {
        status: isFutureActive
          ? EnterpriseContractPeriodStatus.void
          : EnterpriseContractPeriodStatus.expired,
      },
    });
  }

  await tx.enterpriseContract.update({
    where: {
      id: contractId,
    },
    data: {
      canceledAt: now,
      status: EnterpriseContractStatus.canceled,
    },
  });
}

export interface CompleteEnterpriseContractsOptions {
  organizationId?: string;
}

export async function completeEnterpriseContractsAfterLastPeriod(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
  options?: CompleteEnterpriseContractsOptions,
): Promise<number> {
  const activeContracts = await tx.enterpriseContract.findMany({
    where: {
      status: EnterpriseContractStatus.active,
      activatedAt: {
        not: null,
      },
      ...(options?.organizationId
        ? { organizationId: options.organizationId }
        : {}),
    },
    select: {
      activatedAt: true,
      id: true,
      periodCount: true,
    },
  });

  let completedCount = 0;

  for (const contract of activeContracts) {
    if (!contract.activatedAt) {
      continue;
    }

    if (
      isEnterpriseContractPastCommercialTerm({
        activatedAt: contract.activatedAt,
        now,
        periodCount: contract.periodCount,
      })
    ) {
      await tx.enterpriseContract.update({
        where: {
          id: contract.id,
        },
        data: {
          status: EnterpriseContractStatus.completed,
        },
      });
      completedCount += 1;
    }
  }

  return completedCount;
}
