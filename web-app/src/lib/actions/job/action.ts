"use server";

import { getSession } from "@/lib/auth/utils";
import { getJobById, updateJobNameById } from "@/lib/db";
import {
  startJob,
  startJobInputSchema,
  StartJobInputSchemaType,
} from "@/lib/services";

import { JobActionErrorCode } from "./error";

export async function startJobWithInputData(
  input: Omit<StartJobInputSchemaType, "userId">,
): Promise<{
  success: boolean;
  data?: { jobId: string };
  error?: { code: string };
}> {
  try {
    // Authentication
    const session = await getSession();
    if (!session) {
      return {
        success: false,
        error: { code: JobActionErrorCode.NOT_AUTHENTICATED },
      };
    }
    const userId = session.user.id;
    const inputDataForService: StartJobInputSchemaType = { ...input, userId };

    // Validation
    const parsedResult = startJobInputSchema.safeParse(inputDataForService);
    if (!parsedResult.success) {
      return {
        success: false,
        error: { code: JobActionErrorCode.INVALID_INPUT },
      };
    }

    const data = parsedResult.data;

    const job = await startJob(data);
    return { success: true, data: { jobId: job.id } };
  } catch (error) {
    if (error instanceof Error) {
      switch (error.message) {
        case "Insufficient balance":
          return {
            success: false,
            error: { code: JobActionErrorCode.INSUFFICIENT_BALANCE },
          };
        default:
          return {
            success: false,
            error: { code: JobActionErrorCode.INTERNAL_SERVER_ERROR },
          };
      }
    }
    console.log("Error starting job", error);
    return {
      success: false,
      error: { code: JobActionErrorCode.INTERNAL_SERVER_ERROR },
    };
  }
}

export async function updateJobName(
  jobId: string,
  name: string | null,
): Promise<{
  success: boolean;
  error?: { code: string };
}> {
  try {
    // Authentication
    const session = await getSession();
    if (!session) {
      return {
        success: false,
        error: { code: JobActionErrorCode.NOT_AUTHENTICATED },
      };
    }
    const userId = session.user.id;

    const job = await getJobById(jobId);
    if (!job) {
      return {
        success: false,
        error: { code: JobActionErrorCode.JOB_NOT_FOUND },
      };
    }

    // check job user id is same as authenticated user
    if (job.userId !== userId) {
      return {
        success: false,
        error: { code: JobActionErrorCode.UNAUTHORIZED },
      };
    }

    // update job name
    await updateJobNameById(jobId, name);
    return { success: true };
  } catch (error) {
    console.error("Error updating job name", error);
    return {
      success: false,
      error: { code: JobActionErrorCode.INTERNAL_SERVER_ERROR },
    };
  }
}
