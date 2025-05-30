"use server";

import { UnAuthorizedError } from "@/lib/auth/errors";
import { getAuthenticatedUser } from "@/lib/auth/utils";
import {
  AgentWithJobs,
  AgentWithRelations,
  getAgentById,
  getAgentByIdWithPricing,
  getAllCreditCosts,
  getHiredAgents,
  getOnlineAgentsWithValidCreditCostUnits,
  prisma,
} from "@/lib/db";
import { JobInputsDataSchemaType } from "@/lib/job-input";
import { getAgentCreditsPrice } from "@/lib/services/";
import { Prisma } from "@/prisma/generated/client";

import {
  fetchAgentInputSchema,
  getAgentPaymentInformation,
} from "./third-party";

/**
 * Get online agents with valid fixed pricing
 * (valid amount unit)
 *
 * This function:
 * - Finds all valid unit from creditCost model
 * - Filter online agents using these valid units
 *
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns An array of `AgentWithRelations`
 */
export async function getOnlineAgentsWithValidPricing(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  // get all credit costs
  const creditCosts = await getAllCreditCosts(tx);
  const validCreditCostUnits = creditCosts.map(({ unit }) => unit);

  return await getOnlineAgentsWithValidCreditCostUnits(
    tx,
    validCreditCostUnits,
  );
}

export async function getHiredAgentsOrderedByLatestJob(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithJobs[]> {
  const user = await getAuthenticatedUser();
  if (!user) {
    throw new UnAuthorizedError();
  }
  const userId = user.id;

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

interface AgentWithCreditPrice {
  agent: AgentWithRelations;
  creditsPrice: Awaited<ReturnType<typeof getAgentCreditsPrice>>;
}

export async function getOnlineAgentsWithCreditsPrice(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithCreditPrice[]> {
  const agents = await getOnlineAgentsWithValidPricing(tx);
  const results = await Promise.allSettled(
    agents.map(async (agent) => {
      const creditsPrice = await getAgentCreditsPrice(agent, tx);
      return { agent, creditsPrice };
    }),
  );
  return results
    .filter(
      (result): result is PromiseFulfilledResult<AgentWithCreditPrice> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value);
}
