"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import { convertCreditsToBaseUnits } from "@/lib/db/services/credit.service";
import { startJob } from "@/lib/db/services/job.service";

const startJobInputSchema = z.object({
  agentId: z.string(),
  maxAcceptedCreditCost: z.number(),
  inputData: z.record(
    z.string(),
    z.number().or(z.string()).or(z.boolean()).or(z.array(z.number())),
  ),
});

export type StartJobInput = z.infer<typeof startJobInputSchema>;

export async function startJobWithInputData(
  formData: StartJobInput,
): Promise<{ jobId: string }> {
  // Authentication
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    throw new Error("Not authenticated");
  }

  // Validation
  const result = startJobInputSchema.safeParse(formData);
  if (!result.success) {
    throw new Error("Invalid input");
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

  return { jobId: job.id };
}
