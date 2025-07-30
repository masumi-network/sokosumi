import "server-only";

import * as Sentry from "@sentry/nextjs";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import { getSession, getSessionOrThrow } from "@/lib/auth/utils";
import {
  agentInclude,
  agentListInclude,
  AgentListWithAgents,
  agentOrderBy,
  AgentWithCreditPrice,
  AgentWithFixedPricing,
  AgentWithJobs,
  AgentWithOrganizations,
  AgentWithRelations,
  CreditsPrice,
} from "@/lib/db/types";
import { JobInputData } from "@/lib/job-input";
import {
  jobInputsDataSchema,
  JobInputsDataSchemaType,
} from "@/lib/job-input/job-input";
import {
  jobStatusResponseSchema,
  JobStatusResponseSchemaType,
  startJobResponseSchema,
  StartJobResponseSchemaType,
} from "@/lib/schemas";
import { Err, Ok, Result } from "@/lib/ts-res";
import { safeAddPathComponent } from "@/lib/utils/url";
import {
  Agent,
  AgentList,
  AgentListType,
  AgentStatus,
  CreditCost,
} from "@/prisma/generated/client";

import { BaseService } from "./base.service";
import { CreditCostService } from "./creditCost.service";
import { MemberService } from "./member.service";

export class AgentService extends BaseService<AgentService> {
  private static thresholdDays =
    getEnvPublicConfig().NEXT_PUBLIC_AGENT_NEW_THRESHOLD_DAYS;

  /**
   * Utility: Checks if a user can access an agent based on organization membership and agent visibility.
   *
   * @param agent - Agent with organization data.
   * @param userOrganizationIds - Organization IDs the user is a member of.
   * @returns True if the user can access the agent, false otherwise.
   */
  private canUserAccessAgent(
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
  private hasValidPricing(
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
  private isAgentAvailable(
    agent: AgentWithRelations,
    organizationIds: string[],
    creditCosts: CreditCost[],
  ): boolean {
    return (
      this.canUserAccessAgent(agent, organizationIds) &&
      this.hasValidPricing(agent, creditCosts)
    );
  }

  /**
   * Retrieves the current session's organization IDs and all credit costs for agent access checks.
   *
   * @param tx - Optional Prisma transaction client for DB operations.
   * @returns Object with userOrganizationIds and creditCosts.
   */
  private async getAgentAccessContext(): Promise<{
    userOrganizationIds: string[];
    creditCosts: CreditCost[];
  }> {
    const session = await getSession();
    const creditCosts = await this.client.creditCost.findMany();
    const userOrganizationIds =
      session?.user.id && session.user.id !== ""
        ? await MemberService.getInstance().getMembersOrganizationIdsByUserId(
            session.user.id,
          )
        : [];
    return { userOrganizationIds, creditCosts };
  }

  // Service

  async getAvailableAgentById(
    agentId: string,
  ): Promise<AgentWithRelations | null> {
    const agent = await this.getShownAgentWithRelationById(
      agentId,
      AgentStatus.ONLINE,
    );
    if (!agent) return null;
    const { userOrganizationIds, creditCosts } =
      await this.getAgentAccessContext();
    if (!this.isAgentAvailable(agent, userOrganizationIds, creditCosts))
      return null;
    return agent;
  }

  /**
   * Retrieves an agent by ID with all relations, without access control.
   *
   * @param agentId - Unique agent identifier.
   * @param tx - Optional Prisma transaction client.
   * @returns The agent with all relations, or null if not found.
   */
  async getAgentById(agentId: string): Promise<AgentWithRelations | null> {
    return await this.getAgentWithRelationsById(agentId);
  }

  /**
   * Retrieves all online agents available to the current user with valid pricing.
   *
   * @param tx - Optional Prisma transaction client.
   * @returns Array of available agents with valid pricing.
   */
  async getAvailableAgents(): Promise<AgentWithRelations[]> {
    const { userOrganizationIds, creditCosts } =
      await this.getAgentAccessContext();
    const onlineAgents = await this.getShownAgentsWithRelationsByStatus(
      AgentStatus.ONLINE,
    );
    return onlineAgents.filter((agent) =>
      this.isAgentAvailable(agent, userOrganizationIds, creditCosts),
    );
  }

  /**
   * Retrieves all online agents available to the user, each with its calculated credit price.
   *
   * - Excludes agents for which credit price calculation fails.
   *
   * @param tx - Optional Prisma transaction client.
   * @returns Array of agents with their calculated credit prices.
   */
  async getAvailableAgentsWithCreditsPrice(): Promise<AgentWithCreditPrice[]> {
    const agents = await this.getAvailableAgents();
    const results = await Promise.allSettled(
      agents.map(async (agent) => {
        const creditsPrice = await this.getAgentCreditsPrice(agent);
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

  async getAgentCreditsPrice(
    agent: AgentWithFixedPricing,
  ): Promise<CreditsPrice> {
    const amounts = agent.pricing?.fixedPricing?.amounts?.map((amount) => ({
      unit: amount.unit,
      amount: Number(amount.amount),
    }));
    if (!amounts) {
      return { cents: BigInt(0), includedFee: BigInt(0) };
    }
    return await CreditCostService.getInstance(this.client).getCreditsPrice(
      amounts,
    );
  }

  /**
   * Retrieves all agents hired by the current user, ordered by the most recent job activity (newest first).
   *
   * - Requires an active user session.
   * - Agents without jobs are placed at the end of the list.
   *
   * @returns Array of hired agents with their jobs, sorted by recent activity.
   * @throws If no active session is found.
   */
  async getHiredAgentsOrderedByLatestJob(): Promise<AgentWithJobs[]> {
    const session = await getSessionOrThrow();
    const userId = session.user.id;
    const activeOrganizationId = session.session.activeOrganizationId;
    const hiredAgentsWithJobs =
      await this.getHiredAgentsWithJobsByUserIdAndOrganization(
        userId,
        activeOrganizationId,
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
   * @returns The agent's input schema definition.
   * @throws If the agent is not found or if the schema cannot be fetched.
   */
  async getAgentInputSchema(agentId: string): Promise<JobInputsDataSchemaType> {
    const agent = await this.getAgentWithRelationsById(agentId);
    if (!agent) {
      throw new Error(`Agent with ID ${agentId} not found`);
    }
    const inputSchemaResult = await this.fetchAgentInputSchema(agent);
    if (!inputSchemaResult.ok) {
      throw new Error(inputSchemaResult.error);
    }
    return inputSchemaResult.data;
  }

  async getFavoriteAgents(): Promise<AgentWithRelations[]> {
    return await this.getAgentsByListType(AgentListType.FAVORITE);
  }

  private async getAgentsByListType(
    type: AgentListType,
  ): Promise<AgentWithRelations[]> {
    const session = await getSessionOrThrow();
    const existingList = await this.getAgentListByUserIdAndType(
      session.user.id,
      type,
    );
    if (existingList) {
      const { userOrganizationIds, creditCosts } =
        await this.getAgentAccessContext();
      return existingList.agents
        .map(AgentService.mapAgentWithIsNew)
        .filter((agent) =>
          this.isAgentAvailable(agent, userOrganizationIds, creditCosts),
        );
    }
    const list = await this.createAgentListByUserIdAndType(
      session.user.id,
      type,
    );
    return list.agents.map(AgentService.mapAgentWithIsNew);
  }

  // Repo

  async getAgentsWithRelations(): Promise<AgentWithRelations[]> {
    const agents = await this.client.agent.findMany({
      include: agentInclude,
    });

    return agents.map(AgentService.mapAgentWithIsNew);
  }

  async getAgentWithRelationsById(
    id: string,
  ): Promise<AgentWithRelations | null> {
    const agent = await this.client.agent.findUnique({
      where: { id },
      include: agentInclude,
    });

    if (!agent) {
      return null;
    }

    return AgentService.mapAgentWithIsNew(agent);
  }

  async getShownAgentWithRelationById(
    agentId: string,
    status: AgentStatus,
  ): Promise<AgentWithRelations | null> {
    const agent = await this.client.agent.findUnique({
      where: { id: agentId, isShown: true, status },
      include: agentInclude,
    });

    if (!agent) {
      return null;
    }

    return AgentService.mapAgentWithIsNew(agent);
  }

  async getShownAgentsWithRelationsByStatus(
    status: AgentStatus,
  ): Promise<AgentWithRelations[]> {
    const agents = await this.client.agent.findMany({
      include: agentInclude,
      orderBy: [...agentOrderBy],
      where: {
        status,
        isShown: true,
      },
    });

    return agents.map(AgentService.mapAgentWithIsNew);
  }

  async getHiredAgentsWithJobsByUserIdAndOrganization(
    userId: string,
    organizationId: string | null | undefined,
  ): Promise<AgentWithJobs[]> {
    const normalizedOrganizationId = organizationId ?? null;
    return await this.client.agent.findMany({
      where: {
        jobs: {
          some: {
            userId,
            organizationId: normalizedOrganizationId,
          },
        },
      },
      include: {
        jobs: {
          where: {
            userId,
            organizationId: normalizedOrganizationId,
          },
          orderBy: {
            startedAt: "desc",
          },
          take: 1,
        },
      },
    });
  }

  // Agent List Methods

  async createAgentListByUserIdAndType(
    userId: string,
    type: AgentListType,
  ): Promise<AgentListWithAgents> {
    return await this.client.agentList.create({
      data: {
        userId,
        type,
      },
      include: agentListInclude,
    });
  }

  async getAgentListByUserIdAndType(
    userId: string,
    type: AgentListType,
  ): Promise<AgentListWithAgents | null> {
    return await this.client.agentList.findUnique({
      where: {
        userId_type: {
          userId,
          type,
        },
      },
      include: agentListInclude,
    });
  }

  async addAgentToAgentListByIdAndUserId(
    agentId: string,
    listType: AgentListType,
    userId: string,
  ): Promise<AgentList> {
    return await this.client.agentList.update({
      where: { userId_type: { userId, type: listType } },
      data: {
        agents: { connect: { id: agentId } },
      },
    });
  }

  async removeAgentFromAgentListByIdAndUserId(
    agentId: string,
    listType: AgentListType,
    userId: string,
  ): Promise<AgentList> {
    return await this.client.agentList.update({
      where: { userId_type: { userId, type: listType } },
      data: {
        agents: { disconnect: { id: agentId } },
      },
    });
  }

  // Static Methods

  static mapAgentWithIsNew(
    agent: Omit<AgentWithRelations, "isNew">,
  ): AgentWithRelations {
    const thresholdMilliseconds = 86_400_000 * AgentService.thresholdDays;

    return {
      ...agent,
      isNew: agent.createdAt > new Date(Date.now() - thresholdMilliseconds),
    };
  }

  // Agent API
  private static getAgentApiBaseUrl(agent: Agent): URL {
    // Validate the API base URL
    const blacklistedHostnames = getEnvSecrets().BLACKLISTED_AGENT_HOSTNAMES;
    const apiBaseUrl = new URL(agent.apiBaseUrl);
    if (blacklistedHostnames.includes(apiBaseUrl.hostname)) {
      throw new Error("Agent API base URL is not allowed");
    }
    if (apiBaseUrl.protocol !== "https:" && apiBaseUrl.protocol !== "http:") {
      throw new Error("Agent API base URL must be HTTP or HTTPS");
    }

    if (apiBaseUrl.search !== "") {
      throw new Error("Agent API base URL must not have a query string");
    }
    if (apiBaseUrl.hash !== "") {
      throw new Error("Agent API base URL must not have a hash");
    }

    const usedUrl = agent.overrideApiBaseUrl ?? agent.apiBaseUrl;
    return new URL(usedUrl);
  }

  static getAgentUrlWithPathComponent(
    agent: Agent,
    pathComponent: string,
  ): URL {
    const baseUrl = this.getAgentApiBaseUrl(agent);
    return safeAddPathComponent(baseUrl, pathComponent);
  }

  async fetchAgentInputSchema(
    agent: AgentWithRelations,
  ): Promise<Result<JobInputsDataSchemaType, string>> {
    const agentContext = {
      agentId: agent.id,
      agentName: agent.name,
      blockchainIdentifier: agent.blockchainIdentifier,
      apiBaseUrl: agent.apiBaseUrl,
    };

    try {
      const inputSchemaUrl = AgentService.getAgentUrlWithPathComponent(
        agent,
        "input_schema",
      );

      // Add breadcrumb for tracking agent API calls
      Sentry.addBreadcrumb({
        category: "Agentic Service API",
        message: `Fetching input schema for agent: ${agent.id}`,
        level: "info",
        data: {
          url: inputSchemaUrl.toString(),
          agentId: agent.id,
          blockchainIdentifier: agent.blockchainIdentifier,
        },
      });

      const response = await fetch(inputSchemaUrl);

      if (!response.ok) {
        // Log HTTP errors (4xx/5xx)
        const errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        Sentry.withScope((scope) => {
          scope.setTag("service", "agent");
          scope.setTag("operation", "fetchInputSchema");
          scope.setTag("error_type", "http_error");
          scope.setContext("agent", agentContext);
          scope.setContext("http_response", {
            status: response.status,
            statusText: response.statusText,
            url: inputSchemaUrl.toString(),
            headers: Object.fromEntries(response.headers.entries()),
          });

          // Use warning level for 4xx errors, error level for 5xx
          const level = response.status >= 500 ? "error" : "warning";
          Sentry.captureMessage(
            `Failed to fetch agent input schema: ${errorMessage}`,
            level,
          );
        });

        return Err(errorMessage);
      }

      let responseData: unknown;
      try {
        responseData = await response.json();
      } catch (jsonError) {
        // Log JSON parsing errors
        Sentry.withScope((scope) => {
          scope.setTag("service", "agent");
          scope.setTag("operation", "fetchInputSchema");
          scope.setTag("error_type", "json_parse_error");
          scope.setContext("agent", agentContext);
          scope.setContext("http_response", {
            status: response.status,
            url: inputSchemaUrl.toString(),
            contentType: response.headers.get("content-type"),
          });

          Sentry.captureException(jsonError, {
            contexts: {
              error_details: {
                message: "Failed to parse JSON response from agent API",
              },
            },
          });
        });

        return Err("Failed to parse JSON response");
      }

      const parsedResult = jobInputsDataSchema().safeParse(responseData);

      if (!parsedResult.success) {
        // Log schema validation errors
        Sentry.withScope((scope) => {
          scope.setTag("service", "agent");
          scope.setTag("operation", "fetchInputSchema");
          scope.setTag("error_type", "schema_validation_error");
          scope.setContext("agent", agentContext);
          scope.setContext("validation_error", {
            issues: parsedResult.error.issues,
            // Sanitize the response data to avoid logging sensitive information
            responseDataKeys:
              responseData && typeof responseData === "object"
                ? Object.keys(responseData)
                : "non-object response",
          });

          Sentry.captureMessage(
            "Agent returned invalid input schema format",
            "error",
          );
        });

        return Err("Failed to parse input schema");
      }

      const inputSchema = parsedResult.data;
      return Ok(inputSchema);
    } catch (err) {
      // Log network errors and other unexpected errors
      Sentry.withScope((scope) => {
        scope.setTag("service", "agent");
        scope.setTag("operation", "fetchInputSchema");
        scope.setTag("error_type", "network_error");
        scope.setContext("agent", agentContext);

        if (err instanceof Error) {
          // Check for specific network error types
          if (
            err.message.includes("fetch failed") ||
            err.message.includes("ECONNREFUSED") ||
            err.message.includes("ETIMEDOUT") ||
            err.message.includes("ENOTFOUND")
          ) {
            scope.setContext("network_error", {
              message: err.message,
              type: "connection_failure",
            });
          }
        }

        Sentry.captureException(err, {
          contexts: {
            error_details: {
              message:
                "Network or unexpected error while fetching agent input schema",
            },
          },
        });
      });

      return Err(String(err));
    }
  }

  async fetchAgentJobStatus(
    agent: AgentWithRelations,
    jobId: string,
  ): Promise<Result<JobStatusResponseSchemaType, string>> {
    try {
      const jobStatusUrl = AgentService.getAgentUrlWithPathComponent(
        agent,
        "status",
      );
      jobStatusUrl.searchParams.set("job_id", jobId);
      const jobStatusResponse = await fetch(jobStatusUrl, {
        method: "GET",
      });

      if (!jobStatusResponse.ok) {
        return Err(jobStatusResponse.statusText);
      }
      const parsedResult = jobStatusResponseSchema.safeParse(
        await jobStatusResponse.json(),
      );
      if (!parsedResult.success) {
        return Err("Failed to parse job status response");
      }

      return Ok(parsedResult.data);
    } catch (err) {
      return Err(String(err));
    }
  }

  async startAgentJob(
    agent: AgentWithRelations,
    identifierFromPurchaser: string,
    inputData: JobInputData,
  ): Promise<Result<StartJobResponseSchemaType, string>> {
    try {
      const startJobUrl = AgentService.getAgentUrlWithPathComponent(
        agent,
        "start_job",
      );
      const startJobResponse = await fetch(startJobUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier_from_purchaser: identifierFromPurchaser,
          input_data: Object.fromEntries(inputData),
        }),
      });

      if (!startJobResponse.ok) {
        return Err("Failed to start job");
      }
      const responseJson = await startJobResponse.json();
      const parsedResult = startJobResponseSchema.safeParse(responseJson);
      if (!parsedResult.success) {
        return Err(
          `Failed to parse start job response: ${JSON.stringify(
            parsedResult.error,
          )}`,
        );
      }

      return Ok(parsedResult.data);
    } catch (err) {
      return Err(String(err));
    }
  }
}
