import "server-only";

import { getSessionOrThrow } from "@/lib/auth/utils";
import { AgentWithJobs, AgentWithRelations } from "@/lib/db";
import {
  prisma,
  retrieveAgentWithFixedPricingById,
  retrieveAgentWithOrganizationsById,
  retrieveAgentWithRelationsById,
  retrieveAllCreditCosts,
  retrieveHiredAgentsWithJobsByUserId,
  retrieveMembersOrganizationIdsByUserId,
  retrieveShownAgentsWithRelationsByStatus,
} from "@/lib/db/repositories";
import { JobInputsDataSchemaType } from "@/lib/job-input";
import { getAgentCreditsPrice } from "@/lib/services/";
import { AgentStatus, Prisma } from "@/prisma/generated/client";

import {
  fetchAgentInputSchema,
  getAgentPaymentInformation,
} from "./third-party";

/**
 * Check if a user has access to a specific agent
 *
 * This function determines whether a user can access an agent based on
 * organization membership. Agents can be either:
 * - Public: No organization restrictions (accessible to all users)
 * - Private: Restricted to specific organizations (only accessible to members)
 *
 * @param userId - The unique identifier of the user requesting access
 * @param agentId - The unique identifier of the agent to check access for
 * @returns A Promise that resolves to true if the user has access, false otherwise
 *
 * @example
 * ```typescript
 * const hasAccess = await canUserAccessAgent("user123", "agent456");
 * if (hasAccess) {
 *   // User can access the agent
 * }
 * ```
 */
async function canUserAccessAgent(
  agentId: string,
  userId?: string,
): Promise<boolean> {
  const agent = await retrieveAgentWithOrganizationsById(agentId);

  // If agent not found, return false
  if (!agent) return false;

  // If agent has no organization restrictions, it's public
  if (agent.organizations.length === 0) return true;

  // If user is not provided, return false
  if (!userId) return false;

  // Check if user is a member of any organization that has access to this agent
  const userOrganizationIds =
    await retrieveMembersOrganizationIdsByUserId(userId);

  return agent.organizations.some((agentOrg) =>
    userOrganizationIds.includes(agentOrg.id),
  );
}

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
  userId?: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  // get all credit costs
  const creditCosts = await retrieveAllCreditCosts(tx);
  const validCreditCostUnits = creditCosts.map(({ unit }) => unit);

  const onlineAgents = await retrieveShownAgentsWithRelationsByStatus(
    AgentStatus.ONLINE,
    tx,
  );

  return onlineAgents
    .filter((agent) => canUserAccessAgent(agent.id, userId))
    .filter((agent) => {
      const amounts = agent.pricing.fixedPricing?.amounts?.map((amount) => ({
        unit: amount.unit,
        amount: Number(amount.amount),
      }));
      if (!amounts) {
        return true;
      }
      return amounts.every(({ unit }) => validCreditCostUnits.includes(unit));
    });
}

export async function getHiredAgentsOrderedByLatestJob(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithJobs[]> {
  const session = await getSessionOrThrow();
  const hiredAgentsWithJobs = await retrieveHiredAgentsWithJobsByUserId(
    session.user.id,
    tx,
  );

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
  const agent = await retrieveAgentWithRelationsById(agentId, tx);

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
  const agent = await retrieveAgentWithFixedPricingById(id, tx);

  if (!agent) {
    throw new Error("Agent not found");
  }
  const agentPricingResult = await getAgentPaymentInformation(agent);
  if (!agentPricingResult.ok) {
    throw new Error(agentPricingResult.error);
  }
  return agentPricingResult.data;
}

export interface AgentWithCreditPrice {
  agent: AgentWithRelations;
  creditsPrice: Awaited<ReturnType<typeof getAgentCreditsPrice>>;
}

export async function getOnlineAgentsWithCreditsPrice(
  userId?: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithCreditPrice[]> {
  const agents = await getOnlineAgentsWithValidPricing(userId, tx);
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
