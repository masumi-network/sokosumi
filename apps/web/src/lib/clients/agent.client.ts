import "server-only";

import * as Sentry from "@sentry/nextjs";
import { Agent } from "@sokosumi/database";
import { createAgentClient, type Result } from "@sokosumi/masumi";
import type {
  InputSchemaResponseSchemaType,
  InputSchemaType,
  JobStatusResponseSchemaType,
  ProvideInputResponseSchemaType,
  StartFreeJobResponseSchemaType,
  StartPaidJobResponseSchemaType,
} from "@sokosumi/masumi/schemas";

import { getEnvSecrets } from "@/config/env.secrets";

// Create the agent client with Sentry integration and web app configuration
const masumiAgentClient = createAgentClient({
  blacklistedHostnames: getEnvSecrets().BLACKLISTED_AGENT_HOSTNAMES,
  onError: (error) => {
    const { type, operation, agentId, message, context } = error;

    // Add breadcrumb for fetchInputSchema operation
    if (operation === "fetchInputSchema") {
      Sentry.addBreadcrumb({
        category: "Agentic Service API",
        message: `Fetching input schema for agent: ${agentId}`,
        level: "info",
        data: context,
      });
    }

    Sentry.withScope((scope) => {
      scope.setTag("service", "agent");
      scope.setTag("operation", operation);
      scope.setTag("error_type", type);
      scope.setContext("error_details", context || {});

      if (type === "http_error") {
        const level = (context?.status as number) >= 500 ? "error" : "warning";
        Sentry.captureMessage(message, level);
      } else if (type === "json_parse_error") {
        Sentry.captureException(new Error(message), {
          contexts: {
            error_details: {
              message: "Failed to parse JSON response from agent API",
            },
          },
        });
      } else if (type === "schema_validation_error") {
        Sentry.captureMessage(message, "error");
      } else if (type === "network_error") {
        Sentry.captureException(new Error(message), {
          contexts: {
            error_details: {
              message:
                "Network or unexpected error while fetching agent input schema",
            },
          },
        });
      }
    });
  },
});

// Wrapper that adapts types and provides the same interface as before
export const agentClient = {
  async startPaidAgentJob(
    agent: Agent,
    identifierFromPurchaser: string,
    inputData: InputSchemaType,
  ): Promise<Result<StartPaidJobResponseSchemaType, string>> {
    return masumiAgentClient.startPaidAgentJob(
      agent,
      identifierFromPurchaser,
      inputData,
    );
  },

  async startFreeAgentJob(
    agent: Agent,
    inputData: InputSchemaType,
  ): Promise<Result<StartFreeJobResponseSchemaType, string>> {
    return masumiAgentClient.startFreeAgentJob(agent, inputData);
  },

  async fetchAgentJobStatus(
    agent: Agent,
    jobId: string,
  ): Promise<Result<JobStatusResponseSchemaType, string>> {
    return masumiAgentClient.fetchAgentJobStatus(agent, jobId);
  },

  async provideJobInput(
    agent: Agent,
    statusId: string,
    jobId: string,
    inputData: InputSchemaType,
  ): Promise<Result<ProvideInputResponseSchemaType, string>> {
    return masumiAgentClient.provideJobInput(agent, statusId, jobId, inputData);
  },

  async fetchAgentInputSchema(
    agent: Agent,
  ): Promise<Result<InputSchemaResponseSchemaType, string>> {
    return masumiAgentClient.fetchAgentInputSchema(agent);
  },
};
