import "server-only";

import { getSession, getSessionOrThrow } from "@/lib/auth/utils";
import {
  AgentWithFixedPricing,
  AgentWithOrganizations,
  AgentWithRelations,
} from "@/lib/db";
import {
  agentListRepository,
  agentRepository,
  creditCostRepository,
  memberRepository,
  prisma,
} from "@/lib/db/repositories";
import { getAgentCreditsPrice } from "@/lib/services";
import {
  AgentListType,
  AgentStatus,
  CreditCost,
  Prisma,
} from "@/prisma/generated/client";

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
