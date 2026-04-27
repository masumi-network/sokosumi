import type { Prisma, Project } from "@sokosumi/database";

type Db = Prisma.TransactionClient;

export async function listProjectsByWorkspace(
  workspaceId: string,
  db: Db,
): Promise<Project[]> {
  return db.project.findMany({
    where: { workspaceId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
}

export async function findProjectByIdInWorkspace(
  projectId: string,
  workspaceId: string,
  db: Db,
): Promise<Project | null> {
  return db.project.findFirst({
    where: { id: projectId, workspaceId },
  });
}

export async function createProject(
  {
    workspaceId,
    name,
    description,
  }: {
    workspaceId: string;
    name: string;
    description: string | null;
  },
  db: Db,
): Promise<Project> {
  return db.project.create({
    data: {
      workspaceId,
      name,
      description,
    },
  });
}

export async function updateProjectInWorkspace(
  projectId: string,
  workspaceId: string,
  data: { name?: string; description?: string | null },
  db: Db,
): Promise<Project | null> {
  const result = await db.project.updateMany({
    where: { id: projectId, workspaceId },
    data,
  });
  if (result.count === 0) {
    return null;
  }
  return db.project.findUniqueOrThrow({
    where: { id: projectId },
  });
}

export async function deleteProjectInWorkspace(
  projectId: string,
  workspaceId: string,
  db: Db,
): Promise<boolean> {
  const result = await db.project.deleteMany({
    where: { id: projectId, workspaceId },
  });
  return result.count > 0;
}

export async function addJobToProject(
  projectId: string,
  workspaceId: string,
  jobId: string,
  db: Db,
): Promise<
  | { ok: true }
  | {
      ok: false;
      reason: "project_not_found" | "job_not_found" | "job_already_in_project";
    }
> {
  const project = await db.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true },
  });
  if (!project) {
    return { ok: false, reason: "project_not_found" };
  }

  const job = await db.job.findFirst({
    where: { id: jobId, workspaceId },
    select: { id: true, projectId: true },
  });
  if (!job) {
    return { ok: false, reason: "job_not_found" };
  }

  if (job.projectId !== null && job.projectId !== projectId) {
    return { ok: false, reason: "job_already_in_project" };
  }

  await db.job.update({
    where: { id: jobId },
    data: { projectId },
  });

  return { ok: true };
}

export async function removeJobFromProject(
  projectId: string,
  workspaceId: string,
  jobId: string,
  db: Db,
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const project = await db.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true },
  });
  if (!project) {
    return { ok: false, reason: "not_found" };
  }

  const result = await db.job.updateMany({
    where: { id: jobId, projectId, workspaceId },
    data: { projectId: null },
  });
  if (result.count === 0) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true };
}

export async function addTaskToProject(
  projectId: string,
  workspaceId: string,
  taskId: string,
  db: Db,
): Promise<
  | { ok: true }
  | {
      ok: false;
      reason:
        | "project_not_found"
        | "task_not_found"
        | "task_already_in_project";
    }
> {
  const project = await db.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true },
  });
  if (!project) {
    return { ok: false, reason: "project_not_found" };
  }

  const task = await db.task.findFirst({
    where: { id: taskId, archivedAt: null, workspaceId },
    select: { id: true, projectId: true },
  });
  if (!task) {
    return { ok: false, reason: "task_not_found" };
  }

  if (task.projectId !== null && task.projectId !== projectId) {
    return { ok: false, reason: "task_already_in_project" };
  }

  await db.task.update({
    where: { id: taskId },
    data: { projectId },
  });

  return { ok: true };
}

export async function removeTaskFromProject(
  projectId: string,
  workspaceId: string,
  taskId: string,
  db: Db,
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const project = await db.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true },
  });
  if (!project) {
    return { ok: false, reason: "not_found" };
  }

  const result = await db.task.updateMany({
    where: { id: taskId, projectId, workspaceId },
    data: { projectId: null },
  });
  if (result.count === 0) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true };
}
