import "server-only";

import { getSession, getSessionOrThrow } from "@/lib/auth/utils";
import {
  AgentWithFixedPricing,
  AgentWithJobs,
  AgentWithOrganizations,
  AgentWithRelations,
} from "@/lib/db";
import {
  createAgentListByUserIdAndType,
  prisma,
  retrieveAgentListByUserIdAndType,
  retrieveAgentsWithRelations,
  retrieveAgentWithFixedPricingById,
  retrieveAgentWithRelationsById,
  retrieveAllCreditCosts,
  retrieveHiredAgentsWithJobsByUserIdAndOrganization,
  retrieveMembersOrganizationIdsByUserId,
  retrieveShownAgentsWithRelationsByStatus,
  retrieveShownAgentWithRelationById,
} from "@/lib/db/repositories";
import { JobInputsDataSchemaType } from "@/lib/job-input";
import { getAgentCreditsPrice } from "@/lib/services";
import {
  AgentListType,
  AgentStatus,
  CreditCost,
  Prisma,
} from "@/prisma/generated/client";

import {
  fetchAgentInputSchema,
  getAgentPaymentInformation,
} from "./third-party";

/**
 * Retrieves the current session, user organization IDs, and all credit costs for agent access checks.
 *
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns Promise<{ session: Session | null, userOrganizationIds: string[], creditCosts: CreditCost[] }>
 */
async function getAgentAccessContext(
  tx: Prisma.TransactionClient = prisma,
): Promise<{
  userOrganizationIds: string[];
  creditCosts: CreditCost[];
}> {
  const session = await getSession();
  const creditCosts = await retrieveAllCreditCosts(tx);
  const userOrganizationIds =
    session?.user.id && session.user.id !== ""
      ? await retrieveMembersOrganizationIdsByUserId(session.user.id, tx)
      : [];
  return { userOrganizationIds, creditCosts };
}

/**
 * Retrieves an available agent by ID with access control validation.
 *
 * This function fetches an agent with all its related data and validates whether
 * the current user (if authenticated) has access to it based on organization
 * membership and agent visibility settings. The function uses a database
 * transaction to ensure data consistency.
 *
 * Access Control Logic:
 * - Returns null if the agent doesn't exist
 * - Returns null if the agent is not shown (`isShown` is false)
 * - Returns the agent if it's public (no organization restrictions)
 * - For organization-restricted agents:
 *   - Returns null if user is not authenticated or not a member of any allowed organization
 *   - Returns the agent if user is a member of at least one allowed organization
 *
 * @param agentId - The unique identifier of the agent to retrieve
 * @returns Promise<AgentWithRelations | null> - The agent with all relations if accessible, null otherwise
 *
 * @example
 * // Get an agent that the current user can access
 * const agent = await getAvailableAgentById("agent123");
 * if (agent) {
 *   // User has access to this agent
 *   console.log(agent.name);
 * } else {
 *   // Agent doesn't exist or user doesn't have access
 * }
 */
export async function getAvailableAgentById(
  agentId: string,
): Promise<AgentWithRelations | null> {
  return await prisma.$transaction(async (tx) => {
    const agent = await retrieveShownAgentWithRelationById(
      agentId,
      AgentStatus.ONLINE,
      tx,
    );
    if (!agent) return null;

    const { userOrganizationIds, creditCosts } =
      await getAgentAccessContext(tx);
    if (!isAgentAvailable(agent, userOrganizationIds, creditCosts)) return null;

    return agent;
  });
}

export async function getAgentById(
  agentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations | null> {
  return await retrieveAgentWithRelationsById(agentId, tx);
}

/**
 * Checks if a specific agent is marked as favorite by the current authenticated user.
 *
 * - Requires an authenticated user session (throws if not authenticated).
 * - Retrieves the user's favorite agent list and checks if the specified agent is included.
 * - Returns false if the user has no favorite list or the agent is not in the list.
 *
 * @param agentId - The unique identifier of the agent to check.
 * @returns Promise<boolean> - Resolves to true if the agent is in the user's favorites, false otherwise.
 * @throws Will throw an error if the user is not authenticated.
 *
 * @example
 * const isFavorite = await isAgentFavorite("agent123");
 * if (isFavorite) {
 *   // Agent is in user's favorites
 * }
 */
export async function isAgentFavorite(agentId: string): Promise<boolean> {
  const session = await getSessionOrThrow();
  const favoriteList = await retrieveAgentListByUserIdAndType(
    session.user.id,
    AgentListType.FAVORITE,
  );
  return favoriteList?.agents.some((agent) => agent.id === agentId) ?? false;
}

/**
 * Determines if an agent is available to the user based on access permissions and pricing validity.
 *
 * - Checks if the user has access to the agent based on organization membership and visibility.
 * - Validates that the agent's pricing configuration is valid according to current credit costs.
 * - Returns true only if both access and pricing checks pass.
 *
 * @param agent - The agent object with relations including organization and pricing data.
 * @param organizationIds - Array of organization IDs the user is a member of.
 * @param creditCosts - Array of valid credit cost objects for pricing validation.
 * @returns boolean - True if the agent is available to the user, false otherwise.
 *
 * @example
 * const isAvailable = isAgentAvailable(agent, userOrganizationIds, creditCosts);
 * if (isAvailable) {
 *   // Agent can be accessed and used by the user
 * }
 */
function isAgentAvailable(
  agent: AgentWithRelations,
  organizationIds: string[],
  creditCosts: CreditCost[],
): boolean {
  if (!canUserAccessAgent(agent, organizationIds)) return false;
  if (!hasValidPricing(agent, creditCosts)) return false;
  return true;
}

/**
 * Checks if a user has access to a specific agent based on organization membership and agent visibility.
 *
 * - Returns false if the agent is not shown (`isShown`).
 * - Returns true if the agent is public (no organization restrictions).
 * - Returns false if the user is not a member of any organization and the agent is restricted.
 * - Returns true if the user is a member of at least one allowed organization.
 *
 * @param agent - The agent object with organization data.
 * @param userOrganizationIds - Array of organization IDs the user is a member of.
 * @returns boolean - True if the user can access the agent, false otherwise.
 *
 * @example
 * const hasAccess = canUserAccessAgent(agent, userOrganizationIds);
 * if (hasAccess) {
 *   // User can access the agent
 * }
 */
function canUserAccessAgent(
  agent: AgentWithOrganizations,
  userOrganizationIds: string[],
): boolean {
  if (!agent.isShown) return false;

  // If agent has no organization restrictions, it's public
  if (agent.organizations.length === 0) return true;

  // If memberOrganizationIds is empty, return false
  if (userOrganizationIds.length === 0) return false;

  return agent.organizations.some((agentOrg) =>
    userOrganizationIds.includes(agentOrg.id),
  );
}

/**
 * Checks if an agent's fixed pricing units are all valid according to the provided credit costs.
 *
 * - If the agent has no fixed pricing amounts, returns true.
 * - Otherwise, ensures every pricing unit is present in the list of valid credit cost units.
 *
 * @param agent - The agent with fixed pricing information.
 * @param creditCosts - Array of valid credit cost objects.
 * @returns boolean - True if all pricing units are valid or if there are no amounts, false otherwise.
 */
function hasValidPricing(
  agent: AgentWithFixedPricing,
  creditCosts: CreditCost[],
): boolean {
  const units = creditCosts.map(({ unit }) => unit);
  const amounts = agent.pricing.fixedPricing?.amounts?.map((amount) => ({
    unit: amount.unit,
    amount: Number(amount.amount),
  }));
  if (!amounts) {
    return true;
  }
  return amounts.every(({ unit }) => units.includes(unit));
}

/**
 * Retrieves all online agents that are available to the current user and have valid fixed pricing units.
 *
 * - Filters agents by online status and user access (organization membership and visibility).
 * - Ensures each agent's pricing units are valid.
 *
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns Promise<AgentWithRelations[]> - Array of available agents with valid pricing.
 */
export async function getAvailableAgents(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  const { userOrganizationIds, creditCosts } = await getAgentAccessContext(tx);
  const onlineAgents = await retrieveShownAgentsWithRelationsByStatus(
    AgentStatus.ONLINE,
    tx,
  );
  return onlineAgents.filter((agent) =>
    isAgentAvailable(agent, userOrganizationIds, creditCosts),
  );
}

export async function getAgents(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  return await retrieveAgentsWithRelations(tx);
}

/**
 * Represents an agent with its calculated credit pricing information.
 *
 * @property agent - The complete agent data including all related entities.
 * @property creditsPrice - The calculated credit price for using this agent, derived from the agent's pricing configuration.
 */
export interface AgentWithCreditPrice {
  agent: AgentWithRelations;
  creditsPrice: Awaited<ReturnType<typeof getAgentCreditsPrice>>;
}

/**
 * Retrieves all online agents available to the user, each with its calculated credit price.
 *
 * - Filters agents by availability and valid pricing.
 * - Calculates the credit price for each agent.
 * - Excludes agents for which credit price calculation fails.
 *
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns Promise<AgentWithCreditPrice[]> - Array of agents with their calculated credit prices.
 *
 * @example
 * const agentsWithPricing = await getAvailableAgentsWithCreditsPrice();
 * agentsWithPricing.forEach(({ agent, creditsPrice }) => {
 *   console.log(`${agent.name}: ${creditsPrice} credits`);
 * });
 */
export async function getAvailableAgentsWithCreditsPrice(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithCreditPrice[]> {
  const agents = await getAvailableAgents(tx);
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

/**
 * Retrieves all agents hired by the current user, ordered by the most recent job activity (newest first).
 *
 * - Requires an active user session.
 * - Fetches agents hired by the user in the active organization.
 * - Sorts agents by the start date of their most recent job (descending).
 * - Agents without jobs are placed at the end of the list.
 *
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns Promise<AgentWithJobs[]> - Array of hired agents with their jobs, sorted by recent activity.
 * @throws Error if no active session is found.
 *
 * @example
 * const hiredAgents = await getHiredAgentsOrderedByLatestJob();
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
 * Retrieves the input schema definition for a specific agent, used to validate job inputs.
 *
 * - Fetches the agent by ID.
 * - Retrieves the input schema from the agent's configuration or third-party source.
 * - Throws an error if the agent or schema cannot be found.
 *
 * @param agentId - The unique identifier of the agent.
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns Promise<JobInputsDataSchemaType> - The agent's input schema definition.
 * @throws Error if the agent is not found or if the schema cannot be fetched.
 *
 * @example
 * const schema = await getAgentInputSchema("agent123");
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
 * Retrieves the pricing information for a specific agent, including fixed pricing and payment structure.
 *
 * - Fetches the agent by ID.
 * - Retrieves the agent's payment information from a third-party source.
 * - Throws an error if the agent or pricing cannot be found.
 *
 * @param id - The unique identifier of the agent.
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns Promise<any> - The agent's pricing information.
 * @throws Error if the agent is not found or if the pricing cannot be fetched.
 *
 * @example
 * const pricing = await getAgentPricing("agent123");
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
 * Retrieves the current user's favorite agents list, filtered by access (organization membership and visibility).
 *
 * - Returns only agents the user can access.
 * - Throws an error if the user session is not found.
 *
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns Promise<AgentWithRelations[]> - The user's favorite agents.
 * @throws Error if the user session is not found.
 *
 * @example
 * const favoriteList = await getFavoriteAgents();
 */
export async function getFavoriteAgents(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  return await getAgentsByListType(AgentListType.FAVORITE, tx);
}

/**
 * Retrieves or creates an agent list of the specified type for the current user, filtered by access.
 *
 * - If the list exists, filters agents by user access (organization membership and visibility).
 * - If the list does not exist, creates a new one.
 * - Throws an error if the user session is not found.
 *
 * @param type - The type of agent list to retrieve or create (e.g., FAVORITE).
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns Promise<AgentWithRelations[]> - The agent list with accessible agents.
 * @throws Error if the user session is not found.
 *
 * @example
 * const favoriteList = await getAgentsByListType(AgentListType.FAVORITE);
 */
async function getAgentsByListType(
  type: AgentListType,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  const session = await getSessionOrThrow();
  const existingList = await retrieveAgentListByUserIdAndType(
    session.user.id,
    type,
    tx,
  );

  if (existingList) {
    const userOrganizationIds = await retrieveMembersOrganizationIdsByUserId(
      session.user.id,
      tx,
    );

    // Filter agents to ensure the user has access to them
    return existingList.agents.filter((agent) =>
      canUserAccessAgent(agent, userOrganizationIds),
    );
  }

  const list = await createAgentListByUserIdAndType(session.user.id, type, tx);
  return list.agents;
}
