"use server";

import { revalidatePath } from "next/cache";

import {
  addAgentToAgentList,
  AgentWithJobs,
  getAgentById,
  getAgentByIdWithPricing,
  getHiredAgents,
  prisma,
  removeAgentFromAgentList,
} from "@/lib/db";
import { JobInputsDataSchemaType } from "@/lib/job-input";
import { Prisma } from "@/prisma/generated/client";

import {
  fetchAgentInputSchema,
  getAgentPaymentInformation,
} from "./third-party";

/**
 * Toggles an agent's presence in a specified list (adds or removes the agent).
 *
 * @param {string} agentId - The unique identifier of the agent to toggle
 * @param {string} listId - The unique identifier of the list to modify
 * @param {boolean} isBookmarked - If true, removes the agent from the list; if false, adds the agent to the list
 * @returns {Promise<{success: boolean}>} An object indicating whether the operation was successful
 * @throws Will log an error to the console if the operation fails
 */
export async function toggleAgentInList(
  agentId: string,
  listId: string,
  isBookmarked: boolean,
): Promise<{ success: boolean }> {
  try {
    if (isBookmarked) {
      await removeAgentFromAgentList(agentId, listId);
    } else {
      await addAgentToAgentList(agentId, listId);
    }

    // Revalidate the app to update the UI
    revalidatePath("/app");
    return { success: true };
  } catch (error) {
    console.error("Error toggling agent in list", error);
    return { success: false };
  }
}

export async function getHiredAgentsOrderedByLatestJob(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithJobs[]> {
  const hiredAgentsWithJobs = await getHiredAgents(userId, tx);

  // Then sort them manually by the startedAt of the most recent job
  return hiredAgentsWithJobs.sort((a, b) => {
    const aLatestJob = a.jobs[0];
    const bLatestJob = b.jobs[0];

    // If either agent has no jobs, put them at the end
    if (!aLatestJob) return 1;
    if (!bLatestJob) return -1;

    // Sort by startedAt descending (newest first)
    return bLatestJob.startedAt.getTime() - aLatestJob.startedAt.getTime();
  });
}

export async function getAgentInputSchema(
  agentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobInputsDataSchemaType> {
  const agent = await getAgentById(agentId, tx);

  if (!agent) {
    throw new Error(`Agent with ID ${agentId} not found`);
  }

  const inputSchemaResult = await fetchAgentInputSchema(agent);
  if (!inputSchemaResult.ok) {
    throw new Error(inputSchemaResult.error);
  }
  return inputSchemaResult.data;
}

export async function getAgentPricing(
  id: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const agent = await getAgentByIdWithPricing(id, tx);

  if (!agent) {
    throw new Error("Agent not found");
  }
  const agentPricingResult = await getAgentPaymentInformation(agent);
  if (!agentPricingResult.ok) {
    throw new Error(agentPricingResult.error);
  }
  return agentPricingResult.data;
}
