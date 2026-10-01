"use server";

import type {
  DisconnectProjectSocialConnectionResponse,
  InitiateProjectSocialConnectionRequest,
  InitiateProjectSocialConnectionResponse,
  Project,
  ProjectCloseStatus,
  ProjectContextMd,
  ProjectSocialConnection,
  SocialPost,
  SocialPostMediaRef,
} from "@sokosumi/core-client";
import {
  CORE_API_ERROR_KINDS,
  normalizeWebsiteUrl,
  projectIdentifierSchema,
  SOCIAL_POST_MEDIA_MAX,
} from "@sokosumi/utils";
import { err, ok, type Result } from "neverthrow";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import {
  CoreApiRequestError,
  coreClient,
  mapCoreApiStatusToCommonErrorCode,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import { projectService } from "@/lib/services/project.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface CreateProjectParameters extends AuthenticatedRequest {
  name: string;
  /** Task ID prefix. Omit to let Core derive one from the name. */
  identifier?: string;
  briefing?: string | null;
  websiteUrl?: string | null;
}

interface UpdateProjectParameters extends AuthenticatedRequest {
  projectId: string;
  name: string;
  identifier?: string;
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

interface CloseProjectParameters extends AuthenticatedRequest {
  projectId: string;
  operationId: string;
  expectedProjectRevision: number;
  reason?: string;
}

interface RecoverProjectCloseParameters extends AuthenticatedRequest {
  projectId: string;
  operationId: string;
  expectedProjectRevision: number;
  reason: string;
}

interface InitiateProjectSocialConnectionParameters
  extends AuthenticatedRequest {
  projectId: string;
  action: InitiateProjectSocialConnectionRequest["action"];
  provider?: ProjectSocialConnection["provider"];
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

interface CreateProjectSocialPostParameters extends AuthenticatedRequest {
  projectId: string;
  text: string;
  media?: SocialPostMediaRef[];
  socialConnectionId?: string | null;
  /** ISO timestamp; Flight-safe stand-in for the Core `Date` field. */
  scheduledAt?: string | null;
  timezone?: string | null;
}

interface UpdateProjectSocialPostParameters extends AuthenticatedRequest {
  projectId: string;
  postId: string;
  text?: string;
  media?: SocialPostMediaRef[];
  socialConnectionId?: string | null;
  revision: number;
}

interface ScheduleProjectSocialPostParameters extends AuthenticatedRequest {
  projectId: string;
  postId: string;
  /** ISO timestamp; Flight-safe stand-in for the Core `Date` field. */
  scheduledAt: string;
  timezone?: string | null;
  socialConnectionId?: string | null;
  revision: number;
}

interface CancelProjectSocialPostParameters extends AuthenticatedRequest {
  projectId: string;
  postId: string;
  revision: number;
}

interface PublishProjectSocialPostParameters extends AuthenticatedRequest {
  projectId: string;
  postId: string;
  revision: number;
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

function revalidateProjectCloseRoutes(projectId: string) {
  revalidateProjectMutationRoutes(projectId);
  revalidatePath(`/projects/${projectId}/calendar`);
  revalidatePath("/calendar");
  revalidatePath("/tasks");
}

function revalidateProjectSocialConnectionMutationRoutes(projectId: string) {
  revalidateProjectMutationRoutes(projectId);
  revalidatePath(`/projects/${projectId}/edit`);
}

function revalidateProjectSocialPostMutationRoutes(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  // Social is a top-level destination scoped by `?projectId=`, and a scheduled
  // post is a Calendar entry, so both surfaces go stale on the same write.
  revalidatePath("/social");
  revalidatePath("/calendar");
}

/** Project write failures the form shows on the Identifier field rather than as a toast. */
type ProjectIdentifierFieldError =
  | { kind: "identifier_invalid" }
  | { kind: "identifier_taken" }
  | { kind: "identifier_immutable" };

type ProjectMutationResult<T> = ActionResultDto<T, ProjectIdentifierFieldError>;

function identifierFieldError(
  error: unknown,
): ProjectIdentifierFieldError | null {
  if (!(error instanceof CoreApiRequestError)) return null;
  if (error.kind === CORE_API_ERROR_KINDS.PROJECT_IDENTIFIER_TAKEN) {
    return { kind: "identifier_taken" };
  }
  if (error.kind === CORE_API_ERROR_KINDS.PROJECT_IDENTIFIER_IMMUTABLE) {
    return { kind: "identifier_immutable" };
  }
  return null;
}

function normalizeProjectIdentifier(
  identifier?: string,
): Result<string | undefined, ProjectIdentifierFieldError> {
  const normalized = identifier?.trim().toUpperCase();
  if (!normalized) return ok(undefined);
  if (!projectIdentifierSchema.safeParse(normalized).success) {
    return err({ kind: "identifier_invalid" });
  }
  return ok(normalized);
}

function throwCoreActionError(error: unknown, fallbackMessage: string): never {
  const { message } = toCoreApiActionError(error);
  throw new Error(message ?? fallbackMessage);
}

const projectCloseSchema = z.object({
  projectId: z.string().trim().min(1),
  operationId: z.string().uuid(),
  expectedProjectRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).optional(),
});

const projectCloseRecoverySchema = projectCloseSchema.extend({
  reason: z.string().trim().min(1),
});

function parseProjectCloseInput(input: CloseProjectParameters) {
  const result = projectCloseSchema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid close request");
  }
  return result.data;
}

function parseProjectCloseRecoveryInput(input: RecoverProjectCloseParameters) {
  const result = projectCloseRecoverySchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      result.error.issues[0]?.message ?? "Invalid recovery request",
    );
  }
  return result.data;
}

export const createProject = withSession<
  CreateProjectParameters,
  ProjectMutationResult<{ projectId: string; project: Project }>
>(async ({ name, identifier, briefing, websiteUrl }) => {
  const normalizedName = normalizeProjectName(name);
  if (!normalizedName) {
    throw new Error("Name required");
  }

  const normalizedWebsiteUrl = normalizeOptionalWebsiteUrl(websiteUrl);
  const normalizedIdentifier = normalizeProjectIdentifier(identifier);
  if (normalizedIdentifier.isErr()) {
    return toActionResult(err(normalizedIdentifier.error));
  }

  try {
    const project = await projectService.createProject({
      name: normalizedName,
      ...(normalizedIdentifier.value
        ? { identifier: normalizedIdentifier.value }
        : {}),
      briefing: normalizeProjectBriefing(briefing),
      websiteUrl: normalizedWebsiteUrl,
    });

    revalidatePath("/projects");
    return toActionResult(ok({ projectId: project.id, project }));
  } catch (error) {
    const fieldError = identifierFieldError(error);
    if (fieldError) return toActionResult(err(fieldError));
    console.error("Failed to create project", error);
    throwCoreActionError(error, "Failed to create project");
  }
});

export const updateProject = withSession<
  UpdateProjectParameters,
  ProjectMutationResult<{ projectId: string }>
>(async ({ projectId, name, identifier, briefing, websiteUrl, logo }) => {
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
  const normalizedIdentifier = normalizeProjectIdentifier(identifier);
  if (normalizedIdentifier.isErr()) {
    return toActionResult(err(normalizedIdentifier.error));
  }

  try {
    await projectService.patchProject(normalizedProjectId, {
      name: normalizedName,
      ...(normalizedIdentifier.value
        ? { identifier: normalizedIdentifier.value }
        : {}),
      ...(briefing !== undefined
        ? { briefing: normalizeProjectBriefing(briefing) }
        : {}),
      ...(normalizedWebsiteUrl !== undefined
        ? { websiteUrl: normalizedWebsiteUrl }
        : {}),
      ...(logo !== undefined ? { logo } : {}),
    });

    revalidateProjectMutationRoutes(normalizedProjectId);
    return toActionResult(ok({ projectId: normalizedProjectId }));
  } catch (error) {
    const fieldError = identifierFieldError(error);
    if (fieldError) return toActionResult(err(fieldError));
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

export const closeProject = withSession<
  CloseProjectParameters,
  ProjectCloseStatus
>(async (input) => {
  const parsed = parseProjectCloseInput(input);

  try {
    const status = await projectService.closeProject(parsed.projectId, {
      operationId: parsed.operationId,
      expectedProjectRevision: parsed.expectedProjectRevision,
      ...(parsed.reason ? { reason: parsed.reason } : {}),
    });
    revalidateProjectCloseRoutes(parsed.projectId);
    return status;
  } catch (error) {
    console.error("Failed to close project", error);
    throwCoreActionError(error, "Failed to close project");
  }
});

export const retryProjectClose = withSession<
  RecoverProjectCloseParameters,
  ProjectCloseStatus
>(async (input) => {
  const parsed = parseProjectCloseRecoveryInput(input);

  try {
    const status = await projectService.retryProjectClose(parsed.projectId, {
      operationId: parsed.operationId,
      expectedProjectRevision: parsed.expectedProjectRevision,
      reason: parsed.reason,
    });
    revalidateProjectCloseRoutes(parsed.projectId);
    return status;
  } catch (error) {
    console.error("Failed to retry project close", error);
    throwCoreActionError(error, "Failed to retry project close");
  }
});

export const cancelProjectCloseOwedWork = withSession<
  RecoverProjectCloseParameters,
  ProjectCloseStatus
>(async (input) => {
  const parsed = parseProjectCloseRecoveryInput(input);

  try {
    const status = await projectService.cancelProjectCloseOwedWork(
      parsed.projectId,
      {
        operationId: parsed.operationId,
        expectedProjectRevision: parsed.expectedProjectRevision,
        reason: parsed.reason,
      },
    );
    revalidateProjectCloseRoutes(parsed.projectId);
    return status;
  } catch (error) {
    console.error("Failed to cancel owed project work", error);
    throwCoreActionError(error, "Failed to cancel owed project work");
  }
});

export const initiateProjectSocialConnection = withSession<
  InitiateProjectSocialConnectionParameters,
  ActionResultDto<InitiateProjectSocialConnectionResponse, ActionError>
>(async ({ projectId, action, socialConnectionId, provider }) => {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) {
    return toActionResult(
      err({ code: CommonErrorCode.BAD_INPUT, message: "Project required" }),
    );
  }

  let input: InitiateProjectSocialConnectionRequest;
  if (action === "connect") {
    if (!provider) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "Social provider required",
        }),
      );
    }
    input = { action, provider };
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
  ActionResultDto<DisconnectProjectSocialConnectionResponse, ActionError>
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

const trimmedId = z.string().trim().min(1);
const optionalConnectionId = z.string().trim().min(1).nullish();
const optionalTimezone = z.string().trim().min(1).nullish();
const isoTimestamp = z.iso.datetime({ offset: true });
const revisionSchema = z.number().int().nonnegative();

const socialPostMediaRefSchema = z.object({
  pathname: z.string().min(1),
  fileUrl: z.string().url(),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
  kind: z.enum(["image", "gif", "video"]),
});

const socialPostMediaSchema = z
  .array(socialPostMediaRefSchema)
  .max(SOCIAL_POST_MEDIA_MAX);

const createProjectSocialPostSchema = z
  .object({
    projectId: trimmedId,
    text: z.string(),
    media: socialPostMediaSchema.optional(),
    socialConnectionId: optionalConnectionId,
    scheduledAt: isoTimestamp.nullish(),
    timezone: optionalTimezone,
  })
  .refine(
    (value) => value.text.trim().length > 0 || (value.media?.length ?? 0) > 0,
    { message: "Text or media is required" },
  );

const updateProjectSocialPostSchema = z
  .object({
    projectId: trimmedId,
    postId: trimmedId,
    text: z.string().optional(),
    media: socialPostMediaSchema.optional(),
    socialConnectionId: optionalConnectionId,
    revision: revisionSchema,
  })
  .refine(
    (value) =>
      value.text === undefined ||
      value.text.trim().length > 0 ||
      (value.media?.length ?? 0) > 0,
    { message: "Text or media is required" },
  );

const scheduleProjectSocialPostSchema = z.object({
  projectId: trimmedId,
  postId: trimmedId,
  scheduledAt: isoTimestamp,
  timezone: optionalTimezone,
  socialConnectionId: optionalConnectionId,
  revision: revisionSchema,
});

const cancelProjectSocialPostSchema = z.object({
  projectId: trimmedId,
  postId: trimmedId,
  revision: revisionSchema,
});

const publishProjectSocialPostSchema = z.object({
  projectId: trimmedId,
  postId: trimmedId,
  revision: revisionSchema,
});

function badSocialPostInput(
  parsed: z.ZodSafeParseError<unknown>,
): ActionResultDto<SocialPost, ActionError> {
  return toActionResult(
    err({
      code: CommonErrorCode.BAD_INPUT,
      message: parsed.error.issues[0]?.message ?? "Invalid Social post input",
    }),
  );
}

export const createProjectSocialPost = withSession<
  CreateProjectSocialPostParameters,
  ActionResultDto<SocialPost, ActionError>
>(
  async ({
    projectId,
    text,
    media,
    socialConnectionId,
    scheduledAt,
    timezone,
  }) => {
    const parsed = createProjectSocialPostSchema.safeParse({
      projectId,
      text,
      media,
      socialConnectionId,
      scheduledAt,
      timezone,
    });
    if (!parsed.success) {
      return badSocialPostInput(parsed);
    }

    try {
      const post = await projectService.createSocialPost(
        parsed.data.projectId,
        {
          text: parsed.data.text,
          ...(parsed.data.media ? { media: parsed.data.media } : {}),
          ...(parsed.data.socialConnectionId
            ? { socialConnectionId: parsed.data.socialConnectionId }
            : {}),
          ...(parsed.data.scheduledAt
            ? { scheduledAt: new Date(parsed.data.scheduledAt) }
            : {}),
          ...(parsed.data.timezone ? { timezone: parsed.data.timezone } : {}),
        },
      );
      revalidateProjectSocialPostMutationRoutes(parsed.data.projectId);
      return toActionResult(ok(post));
    } catch (error) {
      return toActionResult(err(toCoreApiActionError(error)));
    }
  },
);

export const updateProjectSocialPost = withSession<
  UpdateProjectSocialPostParameters,
  ActionResultDto<SocialPost, ActionError>
>(async ({ projectId, postId, text, media, socialConnectionId, revision }) => {
  const parsed = updateProjectSocialPostSchema.safeParse({
    projectId,
    postId,
    text,
    media,
    socialConnectionId,
    revision,
  });
  if (!parsed.success) {
    return badSocialPostInput(parsed);
  }

  try {
    const post = await projectService.updateSocialPost(
      parsed.data.projectId,
      parsed.data.postId,
      {
        ...(parsed.data.text !== undefined ? { text: parsed.data.text } : {}),
        ...(parsed.data.media !== undefined
          ? { media: parsed.data.media }
          : {}),
        ...(parsed.data.socialConnectionId !== undefined
          ? { socialConnectionId: parsed.data.socialConnectionId }
          : {}),
        revision: parsed.data.revision,
      },
    );
    revalidateProjectSocialPostMutationRoutes(parsed.data.projectId);
    return toActionResult(ok(post));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const scheduleProjectSocialPost = withSession<
  ScheduleProjectSocialPostParameters,
  ActionResultDto<SocialPost, ActionError>
>(
  async ({
    projectId,
    postId,
    scheduledAt,
    timezone,
    socialConnectionId,
    revision,
  }) => {
    const parsed = scheduleProjectSocialPostSchema.safeParse({
      projectId,
      postId,
      scheduledAt,
      timezone,
      socialConnectionId,
      revision,
    });
    if (!parsed.success) {
      return badSocialPostInput(parsed);
    }

    try {
      const post = await projectService.scheduleSocialPost(
        parsed.data.projectId,
        parsed.data.postId,
        {
          scheduledAt: new Date(parsed.data.scheduledAt),
          ...(parsed.data.timezone ? { timezone: parsed.data.timezone } : {}),
          ...(parsed.data.socialConnectionId
            ? { socialConnectionId: parsed.data.socialConnectionId }
            : {}),
          revision: parsed.data.revision,
        },
      );
      revalidateProjectSocialPostMutationRoutes(parsed.data.projectId);
      return toActionResult(ok(post));
    } catch (error) {
      return toActionResult(err(toCoreApiActionError(error)));
    }
  },
);

export const cancelProjectSocialPost = withSession<
  CancelProjectSocialPostParameters,
  ActionResultDto<SocialPost, ActionError>
>(async ({ projectId, postId, revision }) => {
  const parsed = cancelProjectSocialPostSchema.safeParse({
    projectId,
    postId,
    revision,
  });
  if (!parsed.success) {
    return badSocialPostInput(parsed);
  }

  try {
    const post = await projectService.cancelSocialPost(
      parsed.data.projectId,
      parsed.data.postId,
      { revision: parsed.data.revision },
    );
    revalidateProjectSocialPostMutationRoutes(parsed.data.projectId);
    return toActionResult(ok(post));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const publishProjectSocialPost = withSession<
  PublishProjectSocialPostParameters,
  ActionResultDto<SocialPost, ActionError>
>(async ({ projectId, postId, revision }) => {
  const parsed = publishProjectSocialPostSchema.safeParse({
    projectId,
    postId,
    revision,
  });
  if (!parsed.success) {
    return badSocialPostInput(parsed);
  }

  try {
    const post = await projectService.publishSocialPost(
      parsed.data.projectId,
      parsed.data.postId,
      { revision: parsed.data.revision },
    );
    revalidateProjectSocialPostMutationRoutes(parsed.data.projectId);
    return toActionResult(ok(post));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
