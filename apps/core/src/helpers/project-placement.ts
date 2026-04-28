import type { Prisma } from "@sokosumi/database";

import { notFound } from "@/helpers/error";

/**
 * Links a job to a project and aligns `workspaceId` with the project's workspace
 * (Option A: project wins for placement when `projectId` is set).
 */
export async function assignJobToProject(
  tx: Prisma.TransactionClient,
  params: { jobId: string; projectId: string },
): Promise<void> {
  const project = await tx.project.findFirst({
    where: { id: params.projectId },
    select: { workspaceId: true },
  });
  if (!project) {
    throw notFound("Project not found");
  }

  await tx.job.update({
    where: { id: params.jobId },
    data: {
      projectId: params.projectId,
      workspaceId: project.workspaceId,
    },
  });
}

/**
 * Links a task to a project and aligns `workspaceId` with the project's workspace
 * (Option A: project wins for placement when `projectId` is set).
 */
export async function assignTaskToProject(
  tx: Prisma.TransactionClient,
  params: { taskId: string; projectId: string },
): Promise<void> {
  const project = await tx.project.findFirst({
    where: { id: params.projectId },
    select: { workspaceId: true },
  });
  if (!project) {
    throw notFound("Project not found");
  }

  await tx.task.update({
    where: { id: params.taskId },
    data: {
      projectId: params.projectId,
      workspaceId: project.workspaceId,
    },
  });
}
