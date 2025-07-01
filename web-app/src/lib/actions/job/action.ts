"use server";

import { ActionError, CommonErrorCode, JobErrorCode } from "@/lib/actions";
import { getSession } from "@/lib/auth/utils";
import { JobWithStatus } from "@/lib/db";
import {
  retrieveJobByBlockchainIdentifier,
  retrieveJobById,
  updateJobNameById,
} from "@/lib/db/repositories";
import {
  jobDetailsNameFormSchema,
  JobDetailsNameFormSchemaType,
  startJobInputSchema,
  StartJobInputSchemaType,
} from "@/lib/schemas";
import { requestRefundJob, startJob } from "@/lib/services";
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
        message: "Bad Input",
        code: CommonErrorCode.BAD_INPUT,
      });
    }
    const parsed = parsedResult.data;

    const job = await startJob(parsed);
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
  data: JobDetailsNameFormSchemaType,
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

    const parsedResult = jobDetailsNameFormSchema().safeParse(data);
    if (!parsedResult.success) {
      return Err({
        message: "Bad Input",
        code: CommonErrorCode.BAD_INPUT,
      });
    }
    const parsed = parsedResult.data;

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
    await updateJobNameById(jobId, parsed.name === "" ? null : parsed.name);
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
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }

    const foundJob =
      await retrieveJobByBlockchainIdentifier(blockchainIdentifier);
    if (!foundJob) {
      return Err({
        message: "Job not found",
        code: JobErrorCode.JOB_NOT_FOUND,
      });
    }

    // check user is owner of job
    if (foundJob.userId !== session.user.id) {
      return Err({
        message: "Unauthorized",
        code: CommonErrorCode.UNAUTHORIZED,
      });
    }

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
