"use server";

import { getSessionOrThrow } from "@/lib/auth/utils";
import { JobInputsDataSchemaType } from "@/lib/job-input/job-input";

import { getAgentInputSchema } from "./service";

export async function getInputSchemaFromAgentId(
  agentId: string,
): Promise<JobInputsDataSchemaType> {
  const session = await getSessionOrThrow();
  if (session.user.id !== agentId) {
    throw new Error("Unauthorized");
  }

  return await getAgentInputSchema(agentId);
}
