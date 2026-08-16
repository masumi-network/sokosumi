"use server";

import { revalidatePath } from "next/cache";

import { toCoreApiActionError } from "@/lib/clients/core.client";
import type { ProjectContextMd } from "@/lib/clients/generated/core/types.gen";
import { projectService } from "@/lib/services/project.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface CreateProjectParameters extends AuthenticatedRequest {
  name: string;
  briefing?: string | null;
}

interface UpdateProjectParameters extends AuthenticatedRequest {
  projectId: string;
  name: string;
  briefing?: string | null;
}

interface GetProjectContextMdParameters extends AuthenticatedRequest {
  projectId: string;
}

interface DeleteProjectParameters extends AuthenticatedRequest {
  projectId: string;
}

interface ProjectJobParameters extends AuthenticatedRequest {
  projectId: string;
  jobId: string;
}

interface ProjectTaskParameters extends AuthenticatedRequest {
  projectId: string;
  taskId: string;
}

function normalizeProjectName(name: string): string {
  return name.trim();
}

function normalizeProjectBriefing(briefing?: string | null): string | null {
  const trimmedBriefing = briefing?.trim();
  return trimmedBriefing ? trimmedBriefing : null;
}

function revalidateProjectMutationRoutes(projectId: string) {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
}

function throwCoreActionError(error: unknown, fallbackMessage: string): never {
  const { message } = toCoreApiActionError(error);
  throw new Error(message ?? fallbackMessage);
}

export const createProject = withSession<
  CreateProjectParameters,
  { projectId: string }
>(async ({ name, briefing }) => {
  const normalizedName = normalizeProjectName(name);
  if (!normalizedName) {
    throw new Error("Name required");
  }

  try {
    const project = await projectService.createProject({
      name: normalizedName,
      briefing: normalizeProjectBriefing(briefing),
    });

    revalidatePath("/projects");
    return { projectId: project.id };
  } catch (error) {
    console.error("Failed to create project", error);
    throwCoreActionError(error, "Failed to create project");
  }
});

export const updateProject = withSession<
  UpdateProjectParameters,
  { projectId: string }
>(async ({ projectId, name, briefing }) => {
  const normalizedProjectId = projectId.trim();
  const normalizedName = normalizeProjectName(name);
  if (!normalizedProjectId) {
    throw new Error("Project required");
  }
  if (!normalizedName) {
    throw new Error("Name required");
  }

  try {
    await projectService.patchProject(normalizedProjectId, {
      name: normalizedName,
      briefing: normalizeProjectBriefing(briefing),
    });

    revalidateProjectMutationRoutes(normalizedProjectId);
    return { projectId: normalizedProjectId };
  } catch (error) {
    console.error("Failed to update project", error);
    throwCoreActionError(error, "Failed to update project");
  }
});

export const getProjectContextMd = withSession<
  GetProjectContextMdParameters,
  ProjectContextMd
>(async ({ projectId }) => {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) {
    throw new Error("Project required");
  }

  try {
    const contextMd =
      await projectService.getProjectContextMd(normalizedProjectId);
    if (!contextMd) {
      throw new Error("Context not found");
    }

    return contextMd;
  } catch (error) {
    console.error("Failed to load project memory", error);
    throwCoreActionError(error, "Failed to load project memory");
  }
});

export const deleteProject = withSession<
  DeleteProjectParameters,
  { projectId: string }
>(async ({ projectId }) => {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) {
    throw new Error("Project required");
  }

  try {
    await projectService.deleteProject(normalizedProjectId);
    revalidateProjectMutationRoutes(normalizedProjectId);
    return { projectId: normalizedProjectId };
  } catch (error) {
    console.error("Failed to delete project", error);
    throwCoreActionError(error, "Failed to delete project");
  }
});

export const addProjectJob = withSession<
  ProjectJobParameters,
  { projectId: string; jobId: string }
>(async ({ projectId, jobId }) => {
  const normalizedProjectId = projectId.trim();
  const normalizedJobId = jobId.trim();
  if (!normalizedProjectId || !normalizedJobId) {
    throw new Error("Project job required");
  }

  try {
    await projectService.addJob(normalizedProjectId, normalizedJobId);
    revalidateProjectMutationRoutes(normalizedProjectId);
    return {
      projectId: normalizedProjectId,
      jobId: normalizedJobId,
    };
  } catch (error) {
    console.error("Failed to add project job", error);
    throwCoreActionError(error, "Failed to add project job");
  }
});

export const removeProjectJob = withSession<
  ProjectJobParameters,
  { projectId: string; jobId: string }
>(async ({ projectId, jobId }) => {
  const normalizedProjectId = projectId.trim();
  const normalizedJobId = jobId.trim();
  if (!normalizedProjectId || !normalizedJobId) {
    throw new Error("Project job required");
  }

  try {
    await projectService.removeJob(normalizedProjectId, normalizedJobId);
    revalidateProjectMutationRoutes(normalizedProjectId);
    return {
      projectId: normalizedProjectId,
      jobId: normalizedJobId,
    };
  } catch (error) {
    console.error("Failed to remove project job", error);
    throwCoreActionError(error, "Failed to remove project job");
  }
});

export const addProjectTask = withSession<
  ProjectTaskParameters,
  { projectId: string; taskId: string }
>(async ({ projectId, taskId }) => {
  const normalizedProjectId = projectId.trim();
  const normalizedTaskId = taskId.trim();
  if (!normalizedProjectId || !normalizedTaskId) {
    throw new Error("Project task required");
  }

  try {
    await projectService.addTask(normalizedProjectId, normalizedTaskId);
    revalidateProjectMutationRoutes(normalizedProjectId);
    return {
      projectId: normalizedProjectId,
      taskId: normalizedTaskId,
    };
  } catch (error) {
    console.error("Failed to add project task", error);
    throwCoreActionError(error, "Failed to add project task");
  }
});

export const removeProjectTask = withSession<
  ProjectTaskParameters,
  { projectId: string; taskId: string }
>(async ({ projectId, taskId }) => {
  const normalizedProjectId = projectId.trim();
  const normalizedTaskId = taskId.trim();
  if (!normalizedProjectId || !normalizedTaskId) {
    throw new Error("Project task required");
  }

  try {
    await projectService.removeTask(normalizedProjectId, normalizedTaskId);
    revalidateProjectMutationRoutes(normalizedProjectId);
    return {
      projectId: normalizedProjectId,
      taskId: normalizedTaskId,
    };
  } catch (error) {
    console.error("Failed to remove project task", error);
    throwCoreActionError(error, "Failed to remove project task");
  }
});
