"use server";

import { headers } from "next/headers";

import { auth } from "@/lib/auth/auth";
import {
  startJob,
  startJobInputSchema,
  StartJobInputSchemaType,
} from "@/lib/services";

import { StartJobErrorCodes } from "./error";

export async function startJobWithInputData(
  input: Omit<StartJobInputSchemaType, "userId">,
): Promise<{
  success: boolean;
  data?: { jobId: string };
  error?: { code: string };
}> {
  // Authentication
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return {
      success: false,
      error: { code: StartJobErrorCodes.NOT_AUTHENTICATED },
    };
  }
  const userId = session.user.id;
  const inputDataForService: StartJobInputSchemaType = { ...input, userId };

  // Validation
  const parsedResult = startJobInputSchema.safeParse(inputDataForService);
  if (!parsedResult.success) {
    return {
      success: false,
      error: { code: StartJobErrorCodes.INVALID_INPUT },
    };
  }

  const data = parsedResult.data;
  try {
    const job = await startJob(data);
    return { success: true, data: { jobId: job.id } };
  } catch (error) {
    if (error instanceof Error) {
      switch (error.message) {
        case "Insufficient balance":
          return {
            success: false,
            error: { code: StartJobErrorCodes.INSUFFICIENT_BALANCE },
          };
        default:
          return {
            success: false,
            error: { code: StartJobErrorCodes.INTERNAL_SERVER_ERROR },
          };
      }
    }
    return {
      success: false,
      error: { code: StartJobErrorCodes.INTERNAL_SERVER_ERROR },
    };
  }
}
