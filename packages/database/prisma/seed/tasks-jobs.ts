import {
  AgentJobStatus,
  JobType,
  TaskStatus,
} from "../../src/generated/prisma/client.js";
import type { SeedContext } from "./context.js";
import { SEED_JOB_AGENT_IDS, SEED_TASK_NAMES } from "./fixtures.js";

async function upsertTask(
  ctx: SeedContext,
  params: {
    name: string;
    status: TaskStatus;
    ownerId: string;
    workspaceId: string;
    organizationId: string | null;
    creatorUserId: string;
    assigneeId: string | null;
  },
) {
  const existing = await ctx.prisma.task.findFirst({
    where: {
      name: params.name,
      ownerId: params.ownerId,
      workspaceId: params.workspaceId,
    },
  });

  if (existing) {
    return ctx.prisma.task.update({
      where: { id: existing.id },
      data: {
        status: params.status,
        assigneeId: params.assigneeId,
        organizationId: params.organizationId,
      },
    });
  }

  return ctx.prisma.task.create({
    data: {
      name: params.name,
      description: `Local seed task (${params.status})`,
      status: params.status,
      ownerId: params.ownerId,
      workspaceId: params.workspaceId,
      organizationId: params.organizationId,
      creatorUserId: params.creatorUserId,
      assigneeId: params.assigneeId,
    },
  });
}

async function upsertJob(
  ctx: SeedContext,
  params: {
    agentJobId: string;
    ownerId: string;
    workspaceId: string;
    organizationId: string | null;
    agentId: string;
    taskId: string | null;
    jobType: JobType;
    status: AgentJobStatus;
    name: string;
    /** Required when jobType is PAID (DB check paid_job_blockchain_required). */
    paidFields?: {
      blockchainIdentifier: string;
      identifierFromPurchaser: string;
      sellerVkey: string;
      payByTime: Date;
      submitResultTime: Date;
      unlockTime: Date;
      externalDisputeUnlockTime: Date;
      transactionId: string;
    };
  },
) {
  const existing = await ctx.prisma.job.findFirst({
    where: {
      agentJobId: params.agentJobId,
      ownerId: params.ownerId,
    },
  });

  const paidCreateData =
    params.jobType === JobType.PAID && params.paidFields
      ? {
          blockchainIdentifier: params.paidFields.blockchainIdentifier,
          identifierFromPurchaser: params.paidFields.identifierFromPurchaser,
          sellerVkey: params.paidFields.sellerVkey,
          payByTime: params.paidFields.payByTime,
          submitResultTime: params.paidFields.submitResultTime,
          unlockTime: params.paidFields.unlockTime,
          externalDisputeUnlockTime:
            params.paidFields.externalDisputeUnlockTime,
          transactionId: params.paidFields.transactionId,
        }
      : {};

  const job =
    existing ??
    (await ctx.prisma.job.create({
      data: {
        agentJobId: params.agentJobId,
        ownerId: params.ownerId,
        workspaceId: params.workspaceId,
        organizationId: params.organizationId,
        agentId: params.agentId,
        taskId: params.taskId,
        jobType: params.jobType,
        name: params.name,
        ...paidCreateData,
      },
    }));

  if (existing) {
    await ctx.prisma.job.update({
      where: { id: existing.id },
      data: {
        workspaceId: params.workspaceId,
        organizationId: params.organizationId,
        agentId: params.agentId,
        taskId: params.taskId,
        jobType: params.jobType,
        name: params.name,
        ...paidCreateData,
      },
    });
  }

  const latestEvent = await ctx.prisma.jobEvent.findFirst({
    where: { jobId: job.id },
    orderBy: { createdAt: "desc" },
  });

  if (latestEvent) {
    await ctx.prisma.jobEvent.update({
      where: { id: latestEvent.id },
      data: { status: params.status },
    });
    return job;
  }

  await ctx.prisma.jobEvent.create({
    data: {
      jobId: job.id,
      status: params.status,
    },
  });

  return job;
}

export async function seedTasksAndJobs(ctx: SeedContext): Promise<void> {
  const { users, orgs, workspaces, agents, coworkers } = ctx;
  const elena = coworkers.elena;

  const draftTask = await upsertTask(ctx, {
    name: SEED_TASK_NAMES.draft,
    status: TaskStatus.DRAFT,
    ownerId: users.alice.id,
    workspaceId: workspaces.acme.id,
    organizationId: orgs.acme.id,
    creatorUserId: users.alice.id,
    assigneeId: elena?.id ?? null,
  });

  const readyTask = await upsertTask(ctx, {
    name: SEED_TASK_NAMES.ready,
    status: TaskStatus.READY,
    ownerId: users.alice.id,
    workspaceId: workspaces.acme.id,
    organizationId: orgs.acme.id,
    creatorUserId: users.alice.id,
    assigneeId: coworkers.hannah?.id ?? null,
  });

  await upsertTask(ctx, {
    name: SEED_TASK_NAMES.completed,
    status: TaskStatus.COMPLETED,
    ownerId: users.alice.id,
    workspaceId: workspaces.alicePersonal.id,
    organizationId: null,
    creatorUserId: users.alice.id,
    assigneeId: coworkers.alex?.id ?? null,
  });

  await upsertJob(ctx, {
    agentJobId: SEED_JOB_AGENT_IDS.completed,
    ownerId: users.alice.id,
    workspaceId: workspaces.alicePersonal.id,
    organizationId: null,
    agentId: agents.freeAgent.id,
    taskId: draftTask.id,
    jobType: JobType.FREE,
    status: AgentJobStatus.COMPLETED,
    name: "Seed completed job",
  });

  const payByTime = new Date(ctx.now);
  const submitResultTime = new Date(ctx.now);
  submitResultTime.setUTCHours(submitResultTime.getUTCHours() + 24);
  const unlockTime = new Date(ctx.now);
  unlockTime.setUTCDate(unlockTime.getUTCDate() + 7);
  const externalDisputeUnlockTime = new Date(ctx.now);
  externalDisputeUnlockTime.setUTCDate(
    externalDisputeUnlockTime.getUTCDate() + 14,
  );

  const existingPaidJob = await ctx.prisma.job.findFirst({
    where: {
      agentJobId: SEED_JOB_AGENT_IDS.running,
      ownerId: users.alice.id,
    },
    select: { id: true, transactionId: true },
  });

  let paidTransactionId = existingPaidJob?.transactionId ?? null;
  if (!paidTransactionId) {
    const spendTx = await ctx.prisma.transaction.create({
      data: {
        // Negative = spend (1 credit)
        amount: -10_000_000_000n,
        userId: users.alice.id,
        organizationId: orgs.acme.id,
      },
    });
    paidTransactionId = spendTx.id;
  }

  await upsertJob(ctx, {
    agentJobId: SEED_JOB_AGENT_IDS.running,
    ownerId: users.alice.id,
    workspaceId: workspaces.acme.id,
    organizationId: orgs.acme.id,
    agentId: agents.fixedAgent.id,
    taskId: readyTask.id,
    jobType: JobType.PAID,
    status: AgentJobStatus.RUNNING,
    name: "Seed running job",
    paidFields: {
      blockchainIdentifier: "seed-paid-job-blockchain-001",
      identifierFromPurchaser: "seed-purchaser-001",
      sellerVkey: "seed_seller_vkey_001",
      payByTime,
      submitResultTime,
      unlockTime,
      externalDisputeUnlockTime,
      transactionId: paidTransactionId,
    },
  });
}
