"use server";

import type { DesignMdJobPayload } from "@sokosumi/masumi/tools";
import { revalidatePath } from "next/cache";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
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
import { organizationService } from "@/lib/services/organization.service";
import {
  DesignMdServiceError,
  designMdService,
  type PersistedDesignMd,
  type StartDesignMdGenerationResult,
} from "@/lib/services/design-md.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
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
    const organizationSlug = await organizationService.getOrganizationSlugById(
      owner.organizationId,
    );

    if (organizationSlug) {
      revalidatePath(`/organizations/${organizationSlug}`);
    }
  }
}

export const startDesignMdGeneration = withSession<
  StartDesignMdGenerationParameters,
  Result<StartDesignMdGenerationResult, ActionError>
>(async (parameters) => {
  const parsedResult = startDesignMdGenerationSchema.safeParse(parameters);
  if (!parsedResult.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: parsedResult.error.issues[0]?.message,
    });
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

    return Ok(result);
  } catch (error) {
    console.error("Failed to start DESIGN.md generation", error);
    return Err(toActionError(error));
  }
});

export const pollDesignMdGeneration = withSession<
  PollDesignMdGenerationParameters,
  Result<DesignMdJobPayload, ActionError>
>(async (parameters) => {
  const parsedResult = pollDesignMdGenerationSchema.safeParse(parameters);
  if (!parsedResult.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: parsedResult.error.issues[0]?.message,
    });
  }

  try {
    return Ok(
      await designMdService.pollDesignMdJob(
        parameters.session,
        parsedResult.data.owner,
        parsedResult.data.jobId,
        parsedResult.data.jobToken,
      ),
    );
  } catch (error) {
    console.error("Failed to poll DESIGN.md generation", error);
    return Err(toActionError(error));
  }
});

export const finalizeDesignMdGeneration = withSession<
  FinalizeDesignMdGenerationParameters,
  Result<PersistedDesignMd, ActionError>
>(async (parameters) => {
  const parsedResult = finalizeDesignMdGenerationSchema.safeParse(parameters);
  if (!parsedResult.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: parsedResult.error.issues[0]?.message,
    });
  }

  try {
    const persisted = await designMdService.finalizeAndPersistDesignMd(
      parameters.session,
      parsedResult.data.owner,
      parsedResult.data.jobId,
      parsedResult.data.jobToken,
    );

    await revalidateOwner(parsedResult.data.owner);
    return Ok(persisted);
  } catch (error) {
    console.error("Failed to finalize DESIGN.md generation", error);
    return Err(toActionError(error));
  }
});

export const saveDesignMdUpload = withSession<
  SaveDesignMdUploadParameters,
  Result<PersistedDesignMd, ActionError>
>(async (parameters) => {
  const parsedResult = saveDesignMdUploadSchema.safeParse(parameters);
  if (!parsedResult.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: parsedResult.error.issues[0]?.message,
    });
  }

  try {
    const persisted = await designMdService.persistUploadedDesignMd(
      parameters.session,
      parsedResult.data.owner,
      parsedResult.data.url,
    );

    await revalidateOwner(parsedResult.data.owner);
    return Ok(persisted);
  } catch (error) {
    console.error("Failed to save DESIGN.md upload", error);
    return Err(toActionError(error));
  }
});

export const removeDesignMd = withSession<
  RemoveDesignMdParameters,
  Result<{ removed: true }, ActionError>
>(async (parameters) => {
  const parsedResult = removeDesignMdSchema.safeParse(parameters);
  if (!parsedResult.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: parsedResult.error.issues[0]?.message,
    });
  }

  try {
    await designMdService.removeDesignMd(
      parameters.session,
      parsedResult.data.owner,
    );
    await revalidateOwner(parsedResult.data.owner);
    return Ok({ removed: true });
  } catch (error) {
    console.error("Failed to remove DESIGN.md", error);
    return Err(toActionError(error));
  }
});
