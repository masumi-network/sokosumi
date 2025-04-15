"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import { startJob } from "@/lib/db/services/job.service";

const startJobInputSchema = z.object({
  agentId: z.string(),
  maxAcceptedCredits: z.bigint(),
  inputData: z.record(
    z.string(),
    z.union([z.number(), z.string(), z.boolean(), z.array(z.number())]),
  ),
});

export type StartJobInput = z.infer<typeof startJobInputSchema>;

export async function startJobWithInputData(input: StartJobInput): Promise<{
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

  // Validation
  const result = startJobInputSchema.safeParse(input);
  if (!result.success) {
    return {
      success: false,
      error: { code: "INVALID_INPUT" },
    };
  }

  const data = result.data;
  const inputMap = new Map(Object.entries(data.inputData));

  try {
    const job = await startJob(
      session.user.id,
      data.agentId,
      data.maxAcceptedCredits,
      inputMap,
    );
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
