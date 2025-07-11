import "server-only";

import * as Sentry from "@sentry/nextjs";

import { getEnvSecrets } from "@/config/env.secrets";
import { getPaymentInformation } from "@/lib/api/generated/registry";
import { getRegistryClient } from "@/lib/api/registry-service.client";
import { AgentWithRelations } from "@/lib/db";
import { jobInputsDataSchema, JobInputsDataSchemaType } from "@/lib/job-input";
import { Err, Ok, Result } from "@/lib/ts-res";
import { safeAddPathComponent } from "@/lib/utils/url";
import { Agent } from "@/prisma/generated/client";

function getAgentApiBaseUrl(agent: Agent): URL {
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

export function getAgentUrlWithPathComponent(
  agent: Agent,
  pathComponent: string,
): URL {
  const baseUrl = getAgentApiBaseUrl(agent);
  return safeAddPathComponent(baseUrl, pathComponent);
}

export async function fetchAgentInputSchema(
  agent: AgentWithRelations,
): Promise<Result<JobInputsDataSchemaType, string>> {
  const agentContext = {
    agentId: agent.id,
    agentName: agent.name,
    blockchainIdentifier: agent.blockchainIdentifier,
    apiBaseUrl: agent.apiBaseUrl,
  };

  try {
    const inputSchemaUrl = getAgentUrlWithPathComponent(agent, "input_schema");

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

interface FixedPricing {
  pricingType: "Fixed";
  FixedPricing: {
    Amounts: Array<{
      amount: string;
      unit: string;
    }>;
  };
}
export async function getAgentPaymentInformation(
  agent: Agent,
): Promise<Result<FixedPricing, string>> {
  try {
    const registryClient = getRegistryClient();

    const paymentInformation = await getPaymentInformation({
      client: registryClient,
      query: {
        agentIdentifier: agent.blockchainIdentifier,
      },
    });
    if (
      !paymentInformation ||
      !paymentInformation.data ||
      !paymentInformation.data.data
    ) {
      return Err("Payment information not found or invalid price");
    }
    return Ok(paymentInformation.data.data.AgentPricing);
  } catch (err) {
    return Err(String(err));
  }
}
