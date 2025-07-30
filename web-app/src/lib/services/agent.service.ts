import "server-only";

import * as Sentry from "@sentry/nextjs";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import {
  agentInclude,
  agentListInclude,
  AgentListWithAgents,
  agentOrderBy,
  AgentWithJobs,
  AgentWithRelations,
} from "@/lib/db/types";
import {
  jobInputsDataSchema,
  JobInputsDataSchemaType,
} from "@/lib/job-input/job-input";
import { Err, Ok, Result } from "@/lib/ts-res";
import { safeAddPathComponent } from "@/lib/utils/url";
import {
  Agent,
  AgentList,
  AgentListType,
  AgentStatus,
} from "@/prisma/generated/client";

import { BaseService } from "./base.service";

export class AgentService extends BaseService<AgentService> {
  private static thresholdDays =
    getEnvPublicConfig().NEXT_PUBLIC_AGENT_NEW_THRESHOLD_DAYS;

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
}
