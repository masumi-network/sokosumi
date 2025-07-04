import "server-only";

import { getSession, getSessionOrThrow } from "@/lib/auth/utils";
import {
  AgentWithJobs,
  AgentWithOrganizations,
  AgentWithRelations,
} from "@/lib/db";
import {
  prisma,
  retrieveAgentWithFixedPricingById,
  retrieveAgentWithRelationsById,
  retrieveAllCreditCosts,
  retrieveHiredAgentsWithJobsByUserIdAndOrganization,
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
 * Check if a user has access to a specific agent based on organization membership
 *
 * This function determines whether a user can access an agent based on
 * organization membership. Agents can be either:
 * - Public: No organization restrictions (accessible to all users)
 * - Private: Restricted to specific organizations (only accessible to members)
 *
 * @param agent - The agent with organization data to check access for
 * @param userOrganizationIds - Array of organization IDs that the user is a member of
 * @returns A Promise that resolves to true if the user has access, false otherwise
 *
 * @example
 * ```typescript
 * const agent = await retrieveAgentWithOrganizationsById("agent456");
 * const userOrganizationIds = await retrieveMembersOrganizationIdsByUserId("user123");
 * const hasAccess = await canUserAccessAgent(agent, userOrganizationIds);
 * if (hasAccess) {
 *   // User can access the agent
 * }
 * ```
 */
function canUserAccessAgent(
  agent: AgentWithOrganizations,
  userOrganizationIds: string[],
): boolean {
  // If agent has no organization restrictions, it's public
  if (agent.organizations.length === 0) return true;

  // If memberOrganizationIds is empty, return false
  if (userOrganizationIds.length === 0) return false;

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
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  // get all credit costs
  const session = await getSession();
  const creditCosts = await retrieveAllCreditCosts(tx);
  const validCreditCostUnits = creditCosts.map(({ unit }) => unit);

  const onlineAgents = await retrieveShownAgentsWithRelationsByStatus(
    AgentStatus.ONLINE,
    tx,
  );

  // First, filter agents asynchronously by access
  const userOrganizationIds =
    session?.user.id && session.user.id !== ""
      ? await retrieveMembersOrganizationIdsByUserId(session.user.id, tx)
      : [];
  return onlineAgents
    .filter((agent) => canUserAccessAgent(agent, userOrganizationIds))
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

/**
 * Retrieve hired agents ordered by their most recent job
 *
 * This function fetches all agents that have been hired by the current user
 * and sorts them by the start date of their most recent job in descending order
 * (newest jobs first). Agents without any jobs are placed at the end of the list.
 *
 * The function requires an active user session and will throw an error if no
 * session is found. It's useful for displaying a user's hired agents in order
 * of recent activity.
 *
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns A Promise that resolves to an array of agents with their jobs, sorted by most recent job activity
 * @throws Error if no active session is found
 *
 * @example
 * ```typescript
 * const hiredAgents = await getHiredAgentsOrderedByLatestJob();
 * // Returns agents sorted by most recent job startedAt date
 * ```
 */
export async function getHiredAgentsOrderedByLatestJob(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithJobs[]> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;
  const activeOrganizationId = session.session.activeOrganizationId;

  const hiredAgentsWithJobs =
    await retrieveHiredAgentsWithJobsByUserIdAndOrganization(
      userId,
      activeOrganizationId,
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

/**
 * Retrieve the input schema for a specific agent
 *
 * This function fetches an agent by ID and retrieves its input schema definition,
 * which describes the structure and validation rules for data that can be submitted
 * to the agent for processing. The schema is used to validate job inputs before
 * they are sent to the agent.
 *
 * @param agentId - The unique identifier of the agent whose input schema to retrieve
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns A Promise that resolves to the agent's input schema definition
 * @throws Error if the agent is not found or if the schema cannot be fetched
 *
 * @example
 * ```typescript
 * const schema = await getAgentInputSchema("agent123");
 * // Returns the input schema for validating job inputs
 * ```
 */
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

/**
 * Retrieve pricing information for a specific agent
 *
 * This function fetches an agent by ID and retrieves its pricing information,
 * including fixed pricing details and payment structure. The pricing data is
 * used to calculate costs for jobs and display pricing information to users.
 *
 * @param id - The unique identifier of the agent whose pricing to retrieve
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns A Promise that resolves to the agent's pricing information
 * @throws Error if the agent is not found or if the pricing cannot be fetched
 *
 * @example
 * ```typescript
 * const pricing = await getAgentPricing("agent123");
 * // Returns the pricing information for the agent
 * ```
 */
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

/**
 * Interface representing an agent with its calculated credit pricing information
 *
 * This interface combines an agent's complete data (including all relations like
 * pricing, tags, ratings, etc.) with its calculated credit price. The credit price
 * is computed based on the agent's fixed pricing structure and represents the cost
 * in credits required to use the agent for a job.
 *
 * @interface AgentWithCreditPrice
 * @property agent - The complete agent data including all related entities
 * @property creditsPrice - The calculated credit price for using this agent, derived from the agent's pricing configuration
 *
 * @example
 * ```typescript
 * const agentWithPrice: AgentWithCreditPrice = {
 *   agent: {
 *     id: "agent123",
 *     name: "My Agent",
 *     // ... other agent properties and relations
 *   },
 *   creditsPrice: 100 // Cost in credits to use this agent
 * };
 * ```
 */
export interface AgentWithCreditPrice {
  agent: AgentWithRelations;
  creditsPrice: Awaited<ReturnType<typeof getAgentCreditsPrice>>;
}

/**
 * Get online agents with their calculated credit pricing
 *
 * This function retrieves all online agents with valid pricing and calculates
 * their credit costs. It combines the functionality of getting online agents
 * with valid pricing and computing their credit prices in a single operation.
 *
 * The function uses Promise.allSettled to handle potential failures gracefully
 * when calculating credit prices for individual agents. If credit price calculation
 * fails for any agent, that agent is excluded from the results rather than
 * causing the entire operation to fail.
 *
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns A Promise that resolves to an array of agents with their calculated credit prices
 *
 * @example
 * ```typescript
 * const agentsWithPricing = await getOnlineAgentsWithCreditsPrice();
 * agentsWithPricing.forEach(({ agent, creditsPrice }) => {
 *   console.log(`${agent.name}: ${creditsPrice} credits`);
 * });
 * ```
 */
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
