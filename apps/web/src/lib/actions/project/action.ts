"use server";

import { normalizeWebsiteUrl } from "@sokosumi/utils";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import {
  CoreApiRequestError,
  coreClient,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import type {
  Project,
  ProjectContextMd,
} from "@/lib/clients/generated/core/types.gen";
import { projectService } from "@/lib/services/project.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface CreateProjectParameters extends AuthenticatedRequest {
  name: string;
  briefing?: string | null;
  websiteUrl?: string | null;
}

interface UpdateProjectParameters extends AuthenticatedRequest {
  projectId: string;
  name: string;
  briefing?: string | null;
  websiteUrl?: string | null;
  logo?: string | null;
}

interface ResolveProjectSiteIconParameters extends AuthenticatedRequest {
  url: string;
  projectId: string;
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

function normalizeOptionalWebsiteUrl(
  websiteUrl?: string | null,
): string | null {
  if (websiteUrl == null) {
    return null;
  }

  const trimmed = websiteUrl.trim();
  if (!trimmed) {
    return null;
  }

  return normalizeWebsiteUrl(trimmed);
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
  { projectId: string; project: Project }
>(async ({ name, briefing, websiteUrl }) => {
  const normalizedName = normalizeProjectName(name);
  if (!normalizedName) {
    throw new Error("Name required");
  }

  try {
    const project = await projectService.createProject({
      name: normalizedName,
      briefing: normalizeProjectBriefing(briefing),
      websiteUrl: normalizeOptionalWebsiteUrl(websiteUrl),
    });

    revalidatePath("/projects");
    return { projectId: project.id, project };
  } catch (error) {
    console.error("Failed to create project", error);
    throwCoreActionError(error, "Failed to create project");
  }
});

export const updateProject = withSession<
  UpdateProjectParameters,
  { projectId: string }
>(async ({ projectId, name, briefing, websiteUrl, logo }) => {
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
      ...(websiteUrl !== undefined
        ? { websiteUrl: normalizeOptionalWebsiteUrl(websiteUrl) }
        : {}),
      ...(logo !== undefined ? { logo } : {}),
    });

    revalidateProjectMutationRoutes(normalizedProjectId);
    return { projectId: normalizedProjectId };
  } catch (error) {
    console.error("Failed to update project", error);
    throwCoreActionError(error, "Failed to update project");
  }
});

const resolveProjectSiteIconSchema = z.object({
  url: z.url(),
  projectId: z.string().trim().min(1),
});

export const resolveProjectSiteIcon = withSession<
  ResolveProjectSiteIconParameters,
  ActionResultDto<{ url: string | null }, ActionError>
>(async ({ url, projectId }) => {
  const parsed = resolveProjectSiteIconSchema.safeParse({ url, projectId });
  if (!parsed.success) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
        message: parsed.error.issues[0]?.message,
      }),
    );
  }

  try {
    const { data } = await coreClient.resolveProjectSiteIcon(
      parsed.data.url,
      parsed.data.projectId,
    );
    return toActionResult(ok({ url: data.url }));
  } catch (error) {
    if (error instanceof CoreApiRequestError && error.status === 400) {
      return toActionResult(
        err({ code: CommonErrorCode.BAD_INPUT, message: error.message }),
      );
    }
    console.error("Failed to resolve project site icon", error);
    return toActionResult(err({ code: CommonErrorCode.INTERNAL_SERVER_ERROR }));
  }
});

export const updateProjectDesignMd = withSession<
  {
    projectId: string;
    content: string;
    extractionId?: string | null;
  } & AuthenticatedRequest,
  { projectId: string }
>(async ({ projectId, content, extractionId }) => {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId || !content.trim()) {
    throw new Error("Project DESIGN.md required");
  }

  try {
    await projectService.updateProjectDesignMd(normalizedProjectId, {
      content,
      extractionId,
    });
    revalidateProjectMutationRoutes(normalizedProjectId);
    return { projectId: normalizedProjectId };
  } catch (error) {
    console.error("Failed to save project DESIGN.md", error);
    throwCoreActionError(error, "Failed to save project DESIGN.md");
  }
});

export const removeProjectDesignMd = withSession<
  { projectId: string } & AuthenticatedRequest,
  { projectId: string }
>(async ({ projectId }) => {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) {
    throw new Error("Project required");
  }

  try {
    await projectService.removeProjectDesignMd(normalizedProjectId);
    revalidateProjectMutationRoutes(normalizedProjectId);
    return { projectId: normalizedProjectId };
  } catch (error) {
    console.error("Failed to remove project DESIGN.md", error);
    throwCoreActionError(error, "Failed to remove project DESIGN.md");
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
