import "server-only";

import { getSession, getSessionOrThrow } from "@/lib/auth/utils";
import {
  AgentWithFixedPricing,
  AgentWithJobs,
  AgentWithOrganizations,
  AgentWithRelations,
} from "@/lib/db";
import {
  agentListRepository,
  agentRepository,
  creditCostRepository,
  mapAgentWithIsNew,
  memberRepository,
  prisma,
} from "@/lib/db/repositories";
import { JobInputsDataSchemaType } from "@/lib/job-input";
import { getAgentCreditsPrice } from "@/lib/services";
import {
  AgentListType,
  AgentStatus,
  CreditCost,
  Prisma,
} from "@/prisma/generated/client";

import { fetchAgentInputSchema } from "./third-party";

/**
 * Utility: Checks if a user can access an agent based on organization membership and agent visibility.
 *
 * @param agent - Agent with organization data.
 * @param userOrganizationIds - Organization IDs the user is a member of.
 * @returns True if the user can access the agent, false otherwise.
 */
function canUserAccessAgent(
  agent: AgentWithOrganizations,
  userOrganizationIds: string[],
): boolean {
  if (!agent.isShown) return false;
  if (agent.organizations.length === 0) return true;
  if (userOrganizationIds.length === 0) return false;
  return agent.organizations.some((agentOrg) =>
    userOrganizationIds.includes(agentOrg.id),
  );
}

/**
 * Utility: Checks if an agent's fixed pricing units are all valid according to the provided credit costs.
 *
 * @param agent - Agent with fixed pricing information.
 * @param creditCosts - Array of valid credit cost objects.
 * @returns True if all pricing units are valid or if there are no amounts, false otherwise.
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
 * Utility: Determines if an agent is available to the user based on access permissions and pricing validity.
 *
 * @param agent - Agent with relations including organization and pricing data.
 * @param organizationIds - Organization IDs the user is a member of.
 * @param creditCosts - Valid credit cost objects for pricing validation.
 * @returns True if the agent is available to the user, false otherwise.
 */
function isAgentAvailable(
  agent: AgentWithRelations,
  organizationIds: string[],
  creditCosts: CreditCost[],
): boolean {
  return (
    canUserAccessAgent(agent, organizationIds) &&
    hasValidPricing(agent, creditCosts)
  );
}

/**
 * Retrieves the current session's organization IDs and all credit costs for agent access checks.
 *
 * @param tx - Optional Prisma transaction client for DB operations.
 * @returns Object with userOrganizationIds and creditCosts.
 */
async function getAgentAccessContext(
  tx: Prisma.TransactionClient = prisma,
): Promise<{
  userOrganizationIds: string[];
  creditCosts: CreditCost[];
}> {
  const session = await getSession();
  const creditCosts = await creditCostRepository.getCreditCosts(tx);
  const userOrganizationIds =
    session?.user.id && session.user.id !== ""
      ? await memberRepository.getMembersOrganizationIdsByUserId(
          session.user.id,
          tx,
        )
      : [];
  return { userOrganizationIds, creditCosts };
}

/**
 * Retrieves an available agent by ID, validating access control for the current user.
 *
 * - Returns null if the agent doesn't exist, is not shown, or the user lacks access.
 * - Returns the agent if accessible.
 *
 * @param agentId - Unique agent identifier.
 * @returns The agent with all relations if accessible, null otherwise.
 */
export async function getAvailableAgentById(
  agentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations | null> {
  const agent = await agentRepository.getShownAgentWithRelationById(
    agentId,
    AgentStatus.ONLINE,
    tx,
  );
  if (!agent) return null;
  const { userOrganizationIds, creditCosts } = await getAgentAccessContext(tx);
  if (!isAgentAvailable(agent, userOrganizationIds, creditCosts)) return null;
  return agent;
}

/**
 * Retrieves an agent by ID with all relations, without access control.
 *
 * @param agentId - Unique agent identifier.
 * @param tx - Optional Prisma transaction client.
 * @returns The agent with all relations, or null if not found.
 */
export async function getAgentById(
  agentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations | null> {
  return await agentRepository.getAgentWithRelationsById(agentId, tx);
}

/**
 * Checks if a specific agent is marked as favorite by the current authenticated user.
 *
 * - Requires an authenticated user session (throws if not authenticated).
 * - Returns true if the agent is in the user's favorites, false otherwise.
 *
 * @param agentId - Unique agent identifier.
 * @returns True if the agent is in the user's favorites, false otherwise.
 * @throws If the user is not authenticated.
 */
export async function isAgentFavorite(agentId: string): Promise<boolean> {
  const session = await getSessionOrThrow();
  const favoriteList = await agentListRepository.getAgentListByUserId(
    session.user.id,
    AgentListType.FAVORITE,
  );
  return favoriteList?.agents.some((agent) => agent.id === agentId) ?? false;
}

/**
 * Retrieves all online agents available to the current user with valid pricing.
 *
 * @param tx - Optional Prisma transaction client.
 * @returns Array of available agents with valid pricing.
 */
export async function getAvailableAgents(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  const { userOrganizationIds, creditCosts } = await getAgentAccessContext(tx);
  const onlineAgents =
    await agentRepository.getShownAgentsWithRelationsByStatus(
      AgentStatus.ONLINE,
      tx,
    );
  return onlineAgents.filter((agent) =>
    isAgentAvailable(agent, userOrganizationIds, creditCosts),
  );
}

/**
 * Retrieves all agents with all relations (no access control).
 *
 * @param tx - Optional Prisma transaction client.
 * @returns Array of all agents with relations.
 */
export async function getAgents(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  return await agentRepository.getAgentsWithRelations(tx);
}

/**
 * Represents an agent with its calculated credit pricing information.
 */
export interface AgentWithCreditPrice {
  agent: AgentWithRelations;
  creditsPrice: Awaited<ReturnType<typeof getAgentCreditsPrice>>;
}

/**
 * Retrieves all online agents available to the user, each with its calculated credit price.
 *
 * - Excludes agents for which credit price calculation fails.
 *
 * @param tx - Optional Prisma transaction client.
 * @returns Array of agents with their calculated credit prices.
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
 * - Agents without jobs are placed at the end of the list.
 *
 * @param tx - Optional Prisma transaction client.
 * @returns Array of hired agents with their jobs, sorted by recent activity.
 * @throws If no active session is found.
 */
export async function getHiredAgentsOrderedByLatestJob(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithJobs[]> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;
  const activeOrganizationId = session.session.activeOrganizationId;
  const hiredAgentsWithJobs =
    await agentRepository.getHiredAgentsWithJobsByUserIdAndOrganization(
      userId,
      activeOrganizationId,
      tx,
    );
  return hiredAgentsWithJobs.sort((a, b) => {
    const aLatestJob = a.jobs[0];
    const bLatestJob = b.jobs[0];
    if (!aLatestJob) return 1;
    if (!bLatestJob) return -1;
    return bLatestJob.startedAt.getTime() - aLatestJob.startedAt.getTime();
  });
}

/**
 * Retrieves the input schema definition for a specific agent, used to validate job inputs.
 *
 * - Throws an error if the agent or schema cannot be found.
 *
 * @param agentId - Unique agent identifier.
 * @param tx - Optional Prisma transaction client.
 * @returns The agent's input schema definition.
 * @throws If the agent is not found or if the schema cannot be fetched.
 */
export async function getAgentInputSchema(
  agentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobInputsDataSchemaType> {
  const agent = await agentRepository.getAgentWithRelationsById(agentId, tx);
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
 * Retrieves the current user's favorite agents list, filtered by access (organization membership and visibility).
 *
 * - Returns only agents the user can access.
 * - Throws an error if the user session is not found.
 *
 * @param tx - Optional Prisma transaction client.
 * @returns The user's favorite agents.
 * @throws If the user session is not found.
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
 * @param tx - Optional Prisma transaction client.
 * @returns The agent list with accessible agents.
 * @throws If the user session is not found.
 */
async function getAgentsByListType(
  type: AgentListType,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  const session = await getSessionOrThrow();
  const existingList = await agentListRepository.getAgentListByUserId(
    session.user.id,
    type,
    tx,
  );
  if (existingList) {
    const { userOrganizationIds, creditCosts } =
      await getAgentAccessContext(tx);
    return existingList.agents
      .map(mapAgentWithIsNew)
      .filter((agent) =>
        isAgentAvailable(agent, userOrganizationIds, creditCosts),
      );
  }
  const list = await agentListRepository.createAgentListForUserId(
    session.user.id,
    type,
    tx,
  );
  return list.agents.map(mapAgentWithIsNew);
}
