import "server-only";

import * as Sentry from "@sentry/nextjs";
import { Agent } from "@sokosumi/database";

import { getEnvSecrets } from "@/config/env.secrets";
import {
  JobInputData,
  jobInputDataSchema,
  JobInputDataSchemaType,
} from "@/lib/job-input";
import {
  jobStatusResponseSchema,
  JobStatusResponseSchemaType,
  startFreeJobResponseSchema,
  StartFreeJobResponseSchemaType,
  startPaidJobResponseSchema,
  StartPaidJobResponseSchemaType,
} from "@/lib/schemas";
import { Err, Ok, Result } from "@/lib/ts-res";
import { safeAddPathComponent } from "@/lib/utils/url";

export const agentClient = (() => {
  function getAgentUrlWithPathComponent(
    agent: Agent,
    pathComponent: string,
  ): URL {
    const baseUrl = getAgentApiBaseUrl(agent);
    return safeAddPathComponent(baseUrl, pathComponent);
  }

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

  return {
    async startPaidAgentJob(
      agent: Agent,
      identifierFromPurchaser: string,
      inputData: JobInputData,
    ): Promise<Result<StartPaidJobResponseSchemaType, string>> {
      try {
        const startJobUrl = getAgentUrlWithPathComponent(agent, "start_job");
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
          return Err("Failed to start agent job");
        }
        const responseJson = await startJobResponse.json();
        const parsedResult = startPaidJobResponseSchema.safeParse(responseJson);
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
    },

    async startFreeAgentJob(
      agent: Agent,
      inputData: JobInputData,
    ): Promise<Result<StartFreeJobResponseSchemaType, string>> {
      try {
        const startJobUrl = getAgentUrlWithPathComponent(agent, "start_job");
        const startJobResponse = await fetch(startJobUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input_data: Object.fromEntries(inputData),
          }),
        });
        if (!startJobResponse.ok) {
          return Err("Failed to start free agent job");
        }
        const responseJson = await startJobResponse.json();
        const parsedResult = startFreeJobResponseSchema.safeParse(responseJson);
        if (!parsedResult.success) {
          return Err(
            `Failed to parse start free job response: ${JSON.stringify(
              parsedResult.error,
            )}`,
          );
        }

        return Ok(parsedResult.data);
      } catch (err) {
        return Err(String(err));
      }
    },

    async fetchAgentJobStatus(
      agent: Agent,
      jobId: string,
    ): Promise<Result<JobStatusResponseSchemaType, string>> {
      try {
        const jobStatusUrl = getAgentUrlWithPathComponent(agent, "status");
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
    },

    async fetchAgentInputSchema(
      agent: Agent,
    ): Promise<Result<JobInputDataSchemaType, string>> {
      const agentContext = {
        agentId: agent.id,
        agentName: agent.name,
        blockchainIdentifier: agent.blockchainIdentifier,
        apiBaseUrl: agent.apiBaseUrl,
      };

      try {
        const inputSchemaUrl = getAgentUrlWithPathComponent(
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

        const parsedResult = jobInputDataSchema().safeParse(responseData);

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
    },
  };
})();
