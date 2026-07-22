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
  },
) {
  const existing = await ctx.prisma.job.findFirst({
    where: {
      agentJobId: params.agentJobId,
      ownerId: params.ownerId,
    },
  });

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
  });
}
