import {
  AgentJobStatus,
  CreditBucketReferenceType,
  finalizedAgentJobStatuses,
  finalizedOnChainJobStatuses,
  jobInclude,
  JobType,
  type JobWithSokosumiStatus,
  OnChainJobStatus,
  Prisma,
  SokosumiJobStatus,
} from "@sokosumi/database";
import { computeJobStatus, isPaidJob, mapJobWithStatus } from "@sokosumi/database/helpers";
import { createAgentClient } from "@sokosumi/masumi";
import { err } from "neverthrow";
import pLimit from "p-limit";

import { paymentClient } from "@/clients/masumi-payment.client";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

import { transformPurchaseToJobUpdate } from "../helpers/purchase";

type AgentJobStatusValue =
  | "awaiting_payment"
  | "awaiting_input"
  | "running"
  | "completed"
  | "failed";

function jobStatusToAgentJobStatus(jobStatus: AgentJobStatusValue): AgentJobStatus {
  switch (jobStatus) {
    case "awaiting_payment":
      return "AWAITING_PAYMENT";
    case "awaiting_input":
      return "AWAITING_INPUT";
    case "running":
      return "RUNNING";
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    default: {
      const _exhaustive: never = jobStatus;
      throw new Error(`Unknown job status: ${_exhaustive}`);
    }
  }
}

function jobsNotFinishedWhereQuery(
  cutoffTime: Date = new Date(Date.now() - 1000 * 60 * 10),
): Prisma.JobWhereInput {
  return {
    OR: [
      {
        purchase: {
          onChainStatus: {
            notIn: finalizedOnChainJobStatuses,
          },
        },
        jobType: JobType.PAID,
      },
      {
        purchase: {
          onChainStatus: null,
        },
        jobType: JobType.PAID,
      },
      {
        jobType: JobType.FREE,
        events: {
          none: {
            status: { in: finalizedAgentJobStatuses },
          },
        },
      },
    ],
    NOT: [
      {
        refundedTransactionId: {
          not: null,
        },
        jobType: JobType.PAID,
      },
      {
        purchase: {
          onChainStatus: { not: OnChainJobStatus.DISPUTED },
        },
        externalDisputeUnlockTime: {
          not: null,
          lt: cutoffTime,
        },
        jobType: JobType.PAID,
      },
      {
        purchase: {
          onChainStatus: null,
        },
        payByTime: { not: null, lt: cutoffTime },
        jobType: JobType.PAID,
      },
      {
        jobType: JobType.DEMO,
      },
    ],
  };
}

function shouldSyncAgentStatus(job: JobWithSokosumiStatus): string | null {
  if (job.jobType === JobType.DEMO || job.refundedTransactionId) {
    return null;
  }

  const agentCompletedEvent = job.events.find(
    (event) => event.status === AgentJobStatus.COMPLETED,
  );
  if (agentCompletedEvent) {
    return null;
  }

  return job.agentJobId;
}

function shouldSyncMasumiStatus(job: JobWithSokosumiStatus): string | null {
  if (
    job.jobType === JobType.FREE ||
    job.jobType === JobType.DEMO ||
    job.refundedTransactionId ||
    job.purchase === null
  ) {
    return null;
  }

  return job.purchase.externalId;
}

async function getJobById(
  tx: Prisma.TransactionClient,
  jobId: string,
): Promise<JobWithSokosumiStatus | null> {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    include: jobInclude,
  });

  return job ? mapJobWithStatus(job) : null;
}

async function refundJob(tx: Prisma.TransactionClient, jobId: string): Promise<void> {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: {
      refundedTransaction: true,
      transaction: true,
    },
  });

  if (job?.refundedTransaction) {
    return;
  }

  const transaction = job?.transaction;
  if (!transaction) {
    throw new Error("Transaction not found");
  }

  const amount = transaction.amount * BigInt(-1);
  const refundTransactionData: Prisma.TransactionCreateInput = {
    amount,
    user: {
      connect: {
        id: transaction.userId,
      },
    },
    ...(transaction.organizationId && {
      organization: {
        connect: {
          id: transaction.organizationId,
        },
      },
    }),
    sourceCreditBucket: {
      create: {
        amount,
        referenceId: jobId,
        referenceType: CreditBucketReferenceType.JOB_REFUND,
        user: {
          connect: {
            id: transaction.userId,
          },
        },
        expiresAt: null,
        ...(transaction.organizationId && {
          organization: {
            connect: {
              id: transaction.organizationId,
            },
          },
        }),
      },
    },
  };

  await tx.job.update({
    where: { id: jobId },
    data: {
      refundedTransaction: {
        create: refundTransactionData,
      },
    },
  });
}

async function syncSingleJob(initialJob: JobWithSokosumiStatus): Promise<void> {
  let job: JobWithSokosumiStatus | null = initialJob;

  if (isPaidJob(job) && job.purchase === null) {
    const purchaseResult = await paymentClient().getPurchaseByBlockchainIdentifier(
      job.blockchainIdentifier,
    );

    if (purchaseResult.isOk()) {
      const purchaseData = transformPurchaseToJobUpdate(purchaseResult.value);
      await prisma.jobPurchase.upsert({
        where: { jobId: job.id },
        update: purchaseData,
        create: {
          ...purchaseData,
          job: {
            connect: {
              id: job.id,
            },
          },
        },
      });
    }

    job = await getJobById(prisma, job.id);
  }

  if (!job) {
    return;
  }

  const oldJobStatus = computeJobStatus(job);
  const agentJobIdToSync = shouldSyncAgentStatus(job);
  const purchaseIdToSync = shouldSyncMasumiStatus(job);

  const agentClient = createAgentClient(
    job.agent.apiBaseUrl,
    job.agent.apiKey,
    getEnv().NETWORK,
  );

  const [agentJobStatusResult, onChainPurchaseResult] = await Promise.all([
    agentJobIdToSync
      ? agentClient.fetchAgentJobStatus(job.agent, agentJobIdToSync)
      : Promise.resolve(err("No agent job ID to sync")),
    purchaseIdToSync
      ? paymentClient().getPurchaseById(purchaseIdToSync)
      : Promise.resolve(err("No purchase ID to sync")),
  ]);

  await prisma.$transaction(async (tx) => {
    if (!job) {
      return;
    }

    if (onChainPurchaseResult.isOk()) {
      const purchaseData = transformPurchaseToJobUpdate(onChainPurchaseResult.value);
      await tx.jobPurchase.update({
        where: { jobId: job.id },
        data: purchaseData,
      });
    }

    if (agentJobStatusResult.isOk()) {
      const latestJobEvent = await tx.jobEvent.findFirst({
        where: {
          jobId: job.id,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const agentJobStatus = jobStatusToAgentJobStatus(
        agentJobStatusResult.value.status as AgentJobStatusValue,
      );

      if (latestJobEvent) {
        if (latestJobEvent.externalId === agentJobStatusResult.value.id) {
          return;
        }

        if (!agentJobStatusResult.value.id && latestJobEvent.status === agentJobStatus) {
          return;
        }
      }

      const inputSchemaData = agentJobStatusResult.value.input_schema;
      let inputSchemaValue: string | undefined;
      if (inputSchemaData) {
        inputSchemaValue =
          "input_data" in inputSchemaData
            ? JSON.stringify(inputSchemaData.input_data)
            : JSON.stringify(inputSchemaData.input_groups);
      }

      await tx.jobEvent.create({
        data: {
          jobId: job.id,
          externalId: agentJobStatusResult.value.id,
          status: agentJobStatus,
          inputSchema: inputSchemaValue,
          result: agentJobStatusResult.value.result,
        },
      });
    }

    job = await getJobById(tx, job.id);
    if (!job) {
      return;
    }

    const newJobStatus = computeJobStatus(job);
    if (
      oldJobStatus !== newJobStatus &&
      (newJobStatus === SokosumiJobStatus.PAYMENT_FAILED ||
        newJobStatus === SokosumiJobStatus.REFUND_RESOLVED)
    ) {
      await refundJob(tx, job.id);
    }
  });
}

export const jobSyncService = {
  async syncJobs(): Promise<void> {
    const jobs = await prisma.job.findMany({
      where: jobsNotFinishedWhereQuery(),
      include: jobInclude,
    });

    console.info("Syncing", jobs.length, "jobs");

    const limit = pLimit(5);
    const syncTasks = jobs.map((job) =>
      limit(() => syncSingleJob(mapJobWithStatus(job))),
    );

    await Promise.allSettled(syncTasks);
  },
};
