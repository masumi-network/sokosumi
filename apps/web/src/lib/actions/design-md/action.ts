"use server";

import type { DesignMdJobPayload } from "@sokosumi/masumi/tools";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import {
  type DesignMdOwnerSchemaType,
  type FinalizeDesignMdGenerationSchemaType,
  finalizeDesignMdGenerationSchema,
  type PollDesignMdGenerationSchemaType,
  pollDesignMdGenerationSchema,
  type RemoveDesignMdSchemaType,
  removeDesignMdSchema,
  type SaveDesignMdUploadSchemaType,
  type StartDesignMdGenerationSchemaType,
  saveDesignMdUploadSchema,
  startDesignMdGenerationSchema,
} from "@/lib/schemas/design-md";
import {
  DesignMdServiceError,
  designMdService,
  type PersistedDesignMd,
  type StartDesignMdGenerationResult,
} from "@/lib/services/design-md.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

type StartDesignMdGenerationParameters = AuthenticatedRequest &
  StartDesignMdGenerationSchemaType;

type PollDesignMdGenerationParameters = AuthenticatedRequest &
  PollDesignMdGenerationSchemaType;

type FinalizeDesignMdGenerationParameters = AuthenticatedRequest &
  FinalizeDesignMdGenerationSchemaType;

type SaveDesignMdUploadParameters = AuthenticatedRequest &
  SaveDesignMdUploadSchemaType;

type RemoveDesignMdParameters = AuthenticatedRequest & RemoveDesignMdSchemaType;

function toActionError(error: unknown): ActionError {
  if (error instanceof DesignMdServiceError) {
    switch (error.code) {
      case "bad_input":
        return {
          code: CommonErrorCode.BAD_INPUT,
          message: error.message,
        };
      case "unauthorized":
        return {
          code: CommonErrorCode.UNAUTHORIZED,
          message: error.message,
        };
      case "external":
      case "internal":
      case "unconfigured":
        return {
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
          message: error.message,
        };
      default: {
        const _exhaustive: never = error.code;
        return {
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
          message: `Unsupported DESIGN.md error: ${_exhaustive}`,
        };
      }
    }
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message: error instanceof Error ? error.message : undefined,
  };
}

async function revalidateOwner(owner: DesignMdOwnerSchemaType): Promise<void> {
  revalidatePath("/account");

  if (owner.type === "organization") {
    const organization = await coreClient.getOrganizationById(
      owner.organizationId,
    );

    if (organization?.data.slug) {
      revalidatePath(`/organizations/${organization.data.slug}`);
    }
  }

  if (owner.type === "project") {
    revalidatePath("/projects");
    revalidatePath(`/projects/${owner.projectId}`);
  }
}

export const startDesignMdGeneration = withSession<
  StartDesignMdGenerationParameters,
  ActionResultDto<StartDesignMdGenerationResult, ActionError>
>(async (parameters) => {
  const parsedResult = startDesignMdGenerationSchema.safeParse(parameters);
  if (!parsedResult.success) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
        message: parsedResult.error.issues[0]?.message,
      }),
    );
  }

  try {
    const result = await designMdService.startDesignMdGeneration(
      parameters.session,
      parsedResult.data.owner,
      parsedResult.data.url,
      parsedResult.data.force,
    );

    if (result.kind === "completed") {
      await revalidateOwner(parsedResult.data.owner);
    }

    return toActionResult(ok(result));
  } catch (error) {
    console.error("Failed to start DESIGN.md generation", error);
    return toActionResult(err(toActionError(error)));
  }
});

export const pollDesignMdGeneration = withSession<
  PollDesignMdGenerationParameters,
  ActionResultDto<DesignMdJobPayload, ActionError>
>(async (parameters) => {
  const parsedResult = pollDesignMdGenerationSchema.safeParse(parameters);
  if (!parsedResult.success) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
        message: parsedResult.error.issues[0]?.message,
      }),
    );
  }

  try {
    return toActionResult(
      ok(
        await designMdService.pollDesignMdJob(
          parameters.session,
          parsedResult.data.owner,
          parsedResult.data.jobId,
          parsedResult.data.jobToken,
        ),
      ),
    );
  } catch (error) {
    console.error("Failed to poll DESIGN.md generation", error);
    return toActionResult(err(toActionError(error)));
  }
});

export const finalizeDesignMdGeneration = withSession<
  FinalizeDesignMdGenerationParameters,
  ActionResultDto<PersistedDesignMd, ActionError>
>(async (parameters) => {
  const parsedResult = finalizeDesignMdGenerationSchema.safeParse(parameters);
  if (!parsedResult.success) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
        message: parsedResult.error.issues[0]?.message,
      }),
    );
  }

  try {
    const persisted = await designMdService.finalizeAndPersistDesignMd(
      parameters.session,
      parsedResult.data.owner,
      parsedResult.data.jobId,
      parsedResult.data.jobToken,
    );

    await revalidateOwner(parsedResult.data.owner);
    return toActionResult(ok(persisted));
  } catch (error) {
    console.error("Failed to finalize DESIGN.md generation", error);
    return toActionResult(err(toActionError(error)));
  }
});

export const saveDesignMdUpload = withSession<
  SaveDesignMdUploadParameters,
  ActionResultDto<PersistedDesignMd, ActionError>
>(async (parameters) => {
  const parsedResult = saveDesignMdUploadSchema.safeParse(parameters);
  if (!parsedResult.success) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
        message: parsedResult.error.issues[0]?.message,
      }),
    );
  }

  try {
    const persisted = await designMdService.persistUploadedDesignMd(
      parsedResult.data.owner,
      parsedResult.data.content,
    );

    await revalidateOwner(parsedResult.data.owner);
    return toActionResult(ok(persisted));
  } catch (error) {
    console.error("Failed to save DESIGN.md upload", error);
    return toActionResult(err(toActionError(error)));
  }
});

export const removeDesignMd = withSession<
  RemoveDesignMdParameters,
  ActionResultDto<{ removed: true }, ActionError>
>(async (parameters) => {
  const parsedResult = removeDesignMdSchema.safeParse(parameters);
  if (!parsedResult.success) {
    return toActionResult(
      err({
        code: CommonErrorCode.BAD_INPUT,
        message: parsedResult.error.issues[0]?.message,
      }),
    );
  }

  try {
    await designMdService.removeDesignMd(parsedResult.data.owner);
    await revalidateOwner(parsedResult.data.owner);
    return toActionResult(ok({ removed: true }));
  } catch (error) {
    console.error("Failed to remove DESIGN.md", error);
    return toActionResult(err(toActionError(error)));
  }
});

/**
 * Copies the active organization's DESIGN.md into a Project as the Project's
 * own file. Core reads the organization file from the caller's workspace and
 * writes only into an empty Project brand, so a brand saved meanwhile is never
 * replaced (409 `project_design_md_exists`, passed on as the error's kind).
 */
export const copyOrganizationDesignMdToProject = withSession<
  AuthenticatedRequest & { projectId: string },
  ActionResultDto<PersistedDesignMd, ActionError>
>(async ({ projectId }) => {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }
  const owner = { type: "project" as const, projectId: normalizedProjectId };

  try {
    const persisted =
      await designMdService.copyOrganizationDesignMdToProject(
        normalizedProjectId,
      );
    await revalidateOwner(owner);
    return toActionResult(ok(persisted));
  } catch (error) {
    // An expired session arrives as the sign-in redirect.
    unstable_rethrow(error);
    if (
      error instanceof CoreApiRequestError &&
      error.kind === CORE_API_ERROR_KINDS.PROJECT_DESIGN_MD_EXISTS
    ) {
      // The re-rendered Project shows the brand that won.
      await revalidateOwner(owner);
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          kind: error.kind,
          status: error.status,
        }),
      );
    }
    console.error("Failed to copy the organization DESIGN.md", error);
    return toActionResult(
      err(
        error instanceof CoreApiRequestError
          ? {
              code: CommonErrorCode.INTERNAL_SERVER_ERROR,
              kind: error.kind,
              status: error.status,
            }
          : toActionError(error),
      ),
    );
  }
});
