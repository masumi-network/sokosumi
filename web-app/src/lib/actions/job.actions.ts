"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import { convertCreditsToBaseUnits } from "@/lib/db/services/credit.service";
import { startJob } from "@/lib/db/services/job.service";

const startJobInputSchema = z.object({
  agentId: z.string(),
  maxAcceptedCreditCost: z.number(),
  inputData: z
    .record(
      z.string(),
      z.union([z.number(), z.string(), z.boolean(), z.array(z.number())]),
    )
    .transform((data) => {
      // Filter out null values
      return Object.fromEntries(
        Object.entries(data).filter(([_, value]) => value !== null),
      );
    }),
});

export type StartJobInput = z.infer<typeof startJobInputSchema>;

export async function startJobWithInputData(formData: StartJobInput): Promise<{
  success: boolean;
  data?: { jobId: string };
  error?: { message: string; code: string };
}> {
  // Authentication
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return {
      success: false,
      error: { message: "Not authenticated", code: "NOT_AUTHENTICATED" },
    };
  }

  // Validation
  const result = startJobInputSchema.safeParse(formData);
  if (!result.success) {
    return {
      success: false,
      error: { message: "Invalid input", code: "INVALID_INPUT" },
    };
  }

  const data = result.data;
  const inputMap = new Map(Object.entries(data.inputData));

  // Start the job using the existing service
  const job = await startJob(
    session.user.id,
    data.agentId,
    BigInt(convertCreditsToBaseUnits(data.maxAcceptedCreditCost)),
    inputMap,
  );

  return { success: true, data: { jobId: job.id } };
}
