"use server";

import {
  ActionError,
  CommonErrorCode,
  JobErrorCode,
} from "@/lib/actions/types";
import { getSession } from "@/lib/auth/utils";
import { JobWithStatus } from "@/lib/db";
import { retrieveJobById, updateJobNameById } from "@/lib/db/repositories";
import {
  requestRefundJob,
  startJob,
  startJobInputSchema,
  StartJobInputSchemaType,
} from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";

export async function startJobWithInputData(
  input: Omit<StartJobInputSchemaType, "userId">,
): Promise<Result<{ jobId: string }, ActionError>> {
  try {
    // Authentication
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }
    const userId = session.user.id;
    const inputDataForService: StartJobInputSchemaType = { ...input, userId };

    // Validation
    const parsedResult = startJobInputSchema.safeParse(inputDataForService);
    if (!parsedResult.success) {
      return Err({
        message: "Invalid input",
        code: JobErrorCode.INVALID_INPUT,
      });
    }

    const data = parsedResult.data;

    const job = await startJob(data);
    return Ok({ jobId: job.id });
  } catch (error) {
    console.error("Error starting job", error);
    if (error instanceof Error) {
      switch (error.message) {
        case "Insufficient balance":
          return Err({
            message: "Insufficient balance",
            code: JobErrorCode.INSUFFICIENT_BALANCE,
          });
        default:
          return Err({
            message: "Internal server error",
            code: CommonErrorCode.INTERNAL_SERVER_ERROR,
          });
      }
    }
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

export async function updateJobName(
  jobId: string,
  name: string | null,
): Promise<Result<void, ActionError>> {
  try {
    // Authentication
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }
    const userId = session.user.id;

    const job = await retrieveJobById(jobId);
    if (!job) {
      return Err({
        message: "Job not found",
        code: JobErrorCode.JOB_NOT_FOUND,
      });
    }

    // check job user id is same as authenticated user
    if (job.userId !== userId) {
      return Err({
        message: "Unauthorized",
        code: CommonErrorCode.UNAUTHORIZED,
      });
    }

    // update job name
    await updateJobNameById(jobId, name);
    return Ok();
  } catch (error) {
    console.error("Error updating job name", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

export async function requestRefundJobByBlockchainIdentifier(
  blockchainIdentifier: string,
): Promise<Result<{ job: JobWithStatus }, ActionError>> {
  try {
    const job = await requestRefundJob(blockchainIdentifier);
    return Ok({ job });
  } catch (error) {
    console.error("Failed to request refund job", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}
