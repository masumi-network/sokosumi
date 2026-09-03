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
  mapCoreApiStatusToCommonErrorCode,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import type {
  InitiateProjectSocialConnectionRequest,
  InitiateProjectSocialConnectionResponse,
  Project,
  ProjectContextMd,
  ProjectSocialConnection,
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

interface InitiateProjectSocialConnectionParameters
  extends AuthenticatedRequest {
  projectId: string;
  action: InitiateProjectSocialConnectionRequest["action"];
  socialConnectionId?: string;
}

interface FinalizeProjectSocialConnectionParameters
  extends AuthenticatedRequest {
  projectId: string;
  connectionId: string;
}

interface DisconnectProjectSocialConnectionParameters
  extends AuthenticatedRequest {
  projectId: string;
  socialConnectionId: string;
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

  const normalized = normalizeWebsiteUrl(trimmed);
  if (!normalized) {
    throw new Error("Invalid website URL");
  }

  return normalized;
}

function revalidateProjectMutationRoutes(projectId: string) {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
}

function revalidateProjectSocialConnectionMutationRoutes(projectId: string) {
  revalidateProjectMutationRoutes(projectId);
  revalidatePath(`/projects/${projectId}/edit`);
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

  const normalizedWebsiteUrl = normalizeOptionalWebsiteUrl(websiteUrl);

  try {
    const project = await projectService.createProject({
      name: normalizedName,
      briefing: normalizeProjectBriefing(briefing),
      websiteUrl: normalizedWebsiteUrl,
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

  const normalizedWebsiteUrl =
    websiteUrl !== undefined
      ? normalizeOptionalWebsiteUrl(websiteUrl)
      : undefined;

  try {
    await projectService.patchProject(normalizedProjectId, {
      name: normalizedName,
      ...(briefing !== undefined
        ? { briefing: normalizeProjectBriefing(briefing) }
        : {}),
      ...(normalizedWebsiteUrl !== undefined
        ? { websiteUrl: normalizedWebsiteUrl }
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
  projectId: z.string().uuid(),
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
    if (error instanceof CoreApiRequestError) {
      const code = mapCoreApiStatusToCommonErrorCode(error.status);
      if (code !== CommonErrorCode.INTERNAL_SERVER_ERROR) {
        return toActionResult(err({ code, message: error.message }));
      }
    }
    console.error("Failed to resolve project site icon", error);
    return toActionResult(err({ code: CommonErrorCode.INTERNAL_SERVER_ERROR }));
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

export const initiateProjectSocialConnection = withSession<
  InitiateProjectSocialConnectionParameters,
  ActionResultDto<InitiateProjectSocialConnectionResponse, ActionError>
>(async ({ projectId, action, socialConnectionId }) => {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) {
    return toActionResult(
      err({ code: CommonErrorCode.BAD_INPUT, message: "Project required" }),
    );
  }

  let input: InitiateProjectSocialConnectionRequest;
  if (action === "connect") {
    input = { action, provider: "x" };
  } else {
    const normalizedSocialConnectionId = socialConnectionId?.trim();
    if (!normalizedSocialConnectionId) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Social connection required",
        }),
      );
    }
    input = { action, socialConnectionId: normalizedSocialConnectionId };
  }

  try {
    const connection = await projectService.initiateSocialConnection(
      normalizedProjectId,
      input,
    );
    return toActionResult(ok(connection));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const finalizeProjectSocialConnection = withSession<
  FinalizeProjectSocialConnectionParameters,
  ActionResultDto<ProjectSocialConnection, ActionError>
>(async ({ projectId, connectionId }) => {
  const normalizedProjectId = projectId.trim();
  const normalizedConnectionId = connectionId.trim();
  if (!normalizedProjectId || !normalizedConnectionId) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
        message: "Project connection required",
      }),
    );
  }

  try {
    const connection = await projectService.finalizeSocialConnection(
      normalizedProjectId,
      normalizedConnectionId,
    );
    revalidateProjectSocialConnectionMutationRoutes(normalizedProjectId);
    return toActionResult(ok(connection));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const disconnectProjectSocialConnection = withSession<
  DisconnectProjectSocialConnectionParameters,
  ActionResultDto<ProjectSocialConnection, ActionError>
>(async ({ projectId, socialConnectionId }) => {
  const normalizedProjectId = projectId.trim();
  const normalizedSocialConnectionId = socialConnectionId.trim();
  if (!normalizedProjectId || !normalizedSocialConnectionId) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
        message: "Project social connection required",
      }),
    );
  }

  try {
    const connection = await projectService.disconnectSocialConnection(
      normalizedProjectId,
      normalizedSocialConnectionId,
    );
    revalidateProjectSocialConnectionMutationRoutes(normalizedProjectId);
    return toActionResult(ok(connection));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
