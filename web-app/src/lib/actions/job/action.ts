"use server";

import { headers } from "next/headers";

import { auth } from "@/lib/auth/auth";
import {
  startJob,
  startJobInputSchema,
  StartJobInputSchemaType,
} from "@/lib/services";

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
      error: { code: "NOT_AUTHENTICATED" },
    };
  }
  const userId = session.user.id;
  const inputDataForService: StartJobInputSchemaType = { ...input, userId };

  // Validation
  const parsedResult = startJobInputSchema.safeParse(inputDataForService);
  if (!parsedResult.success) {
    return {
      success: false,
      error: { code: "INVALID_INPUT" },
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
          return { success: false, error: { code: "INSUFFICIENT_BALANCE" } };
        default:
          return { success: false, error: { code: "INTERNAL_SERVER_ERROR" } };
      }
    }
    return { success: false, error: { code: "INTERNAL_SERVER_ERROR" } };
  }
}
