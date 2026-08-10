"use server";

import type { DesignMdJobPayload } from "@sokosumi/masumi/tools";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { coreClient } from "@/lib/clients/core.client";
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
