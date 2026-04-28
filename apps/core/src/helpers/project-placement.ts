import type { Prisma } from "@sokosumi/database";

import { conflict, notFound } from "@/helpers/error";

/**
 * Links a job to a project and aligns `workspaceId` with the project's workspace
 * (Option A: project wins for placement when `projectId` is set).
 *
 * Callers should run this inside a `Serializable` `prisma.$transaction` together
 * with any prerequisite reads so conflict checks and the write stay atomic.
 * Uses `updateMany` with a conditional `where` so a concurrent assign to another
 * project cannot be overwritten silently.
 */
export async function assignJobToProject(
  tx: Prisma.TransactionClient,
  params: { jobId: string; projectId: string; workspaceId: string },
): Promise<void> {
  const project = await tx.project.findFirst({
    where: { id: params.projectId, workspaceId: params.workspaceId },
    select: { workspaceId: true },
  });
  if (!project) {
    throw notFound("Project not found");
  }

  const { count } = await tx.job.updateMany({
    where: {
      id: params.jobId,
      workspaceId: params.workspaceId,
      OR: [{ projectId: null }, { projectId: params.projectId }],
    },
    data: {
      projectId: params.projectId,
      workspaceId: project.workspaceId,
    },
  });

  if (count === 0) {
    const job = await tx.job.findFirst({
      where: { id: params.jobId, workspaceId: params.workspaceId },
      select: { id: true },
    });
    if (!job) {
      throw notFound("Job not found");
    }
    throw conflict("Job is already assigned to a project");
  }
}

/**
 * Links a task to a project and aligns `workspaceId` with the project's workspace
 * (Option A: project wins for placement when `projectId` is set).
 *
 * Same concurrency expectations as {@link assignJobToProject}.
 */
export async function assignTaskToProject(
  tx: Prisma.TransactionClient,
  params: { taskId: string; projectId: string; workspaceId: string },
): Promise<void> {
  const project = await tx.project.findFirst({
    where: { id: params.projectId, workspaceId: params.workspaceId },
    select: { workspaceId: true },
  });
  if (!project) {
    throw notFound("Project not found");
  }

  const { count } = await tx.task.updateMany({
    where: {
      id: params.taskId,
      workspaceId: params.workspaceId,
      archivedAt: null,
      OR: [{ projectId: null }, { projectId: params.projectId }],
    },
    data: {
      projectId: params.projectId,
      workspaceId: project.workspaceId,
    },
  });

  if (count === 0) {
    const task = await tx.task.findFirst({
      where: {
        id: params.taskId,
        workspaceId: params.workspaceId,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!task) {
      throw notFound("Task not found");
    }
    throw conflict("Task is already assigned to a project");
  }
}
