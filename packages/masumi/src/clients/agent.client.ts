import {
  inputSchemaResponseSchema,
  InputSchemaResponseSchemaType,
  InputSchemaType,
  jobStatusResponseSchema,
  JobStatusResponseSchemaType,
  provideInputResponseSchema,
  ProvideInputResponseSchemaType,
  startFreeJobResponseSchema,
  StartFreeJobResponseSchemaType,
  startPaidJobResponseSchema,
  StartPaidJobResponseSchemaType,
} from "../schemas/index.js";
import type { Agent } from "../types/agent.js";
import { Err, Ok, type Result } from "../utils/result.js";
import { safeAddPathComponent } from "../utils/url.js";

/**
 * Configuration for the agent client.
 */
export interface AgentClientConfig {
  /**
   * List of hostnames that are not allowed for agent API calls.
   */
  blacklistedHostnames?: string[];
  /**
   * Optional error tracking function.
   * Called when errors occur during agent API operations.
   */
  onError?: (error: {
    type:
      | "http_error"
      | "json_parse_error"
      | "schema_validation_error"
      | "network_error";
    operation: string;
    agentId: string;
    message: string;
    context?: Record<string, unknown>;
  }) => void;
}

/**
 * Creates an agent client with the provided configuration.
 */
export function createAgentClient(config?: AgentClientConfig) {
  function getAgentUrlWithPathComponent(
    agent: Agent,
    pathComponent: string,
  ): URL {
    const baseUrl = getAgentApiBaseUrl(agent, config);
    return safeAddPathComponent(baseUrl, pathComponent);
  }

  function getAgentApiBaseUrl(agent: Agent, config?: AgentClientConfig): URL {
    // Validate the API base URL
    const apiBaseUrl = new URL(agent.apiBaseUrl);
    if (
      config?.blacklistedHostnames &&
      config?.blacklistedHostnames.includes(apiBaseUrl.hostname)
    ) {
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

  function logError(
    type:
      | "http_error"
      | "json_parse_error"
      | "schema_validation_error"
      | "network_error",
    operation: string,
    agent: Agent,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    config?.onError?.({
      type,
      operation,
      agentId: agent.id,
      message,
      context: {
        ...context,
        agentName: agent.name,
        blockchainIdentifier: agent.blockchainIdentifier,
        apiBaseUrl: agent.apiBaseUrl,
      },
    });
  }

  return {
    async startPaidAgentJob(
      agent: Agent,
      identifierFromPurchaser: string,
      inputData: InputSchemaType,
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
            input_data: inputData,
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
      inputData: InputSchemaType,
    ): Promise<Result<StartFreeJobResponseSchemaType, string>> {
      try {
        const startJobUrl = getAgentUrlWithPathComponent(agent, "start_job");
        const startJobResponse = await fetch(startJobUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input_data: inputData,
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

    async provideJobInput(
      agent: Agent,
      statusId: string,
      jobId: string,
      inputData: InputSchemaType,
    ): Promise<Result<ProvideInputResponseSchemaType, string>> {
      try {
        const provideInputUrl = getAgentUrlWithPathComponent(
          agent,
          "provide_input",
        );

        const body = JSON.stringify({
          job_id: jobId,
          status_id: statusId,
          input_data: inputData,
        });

        const provideInputResponse = await fetch(provideInputUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body,
        });

        if (!provideInputResponse.ok) {
          return Err(
            `Failed to provide job input: ${provideInputResponse.status} ${provideInputResponse.statusText}`,
          );
        }
        const responseJson = await provideInputResponse.json();
        const parsedResult = provideInputResponseSchema.safeParse(responseJson);
        if (!parsedResult.success) {
          return Err(
            `Failed to parse provide input response: ${JSON.stringify(
              parsedResult.error,
            )}`,
          );
        }

        return Ok(parsedResult.data);
      } catch (err) {
        return Err(String(err));
      }
    },

    async fetchAgentInputSchema(
      agent: Agent,
    ): Promise<Result<InputSchemaResponseSchemaType, string>> {
      try {
        const inputSchemaUrl = getAgentUrlWithPathComponent(
          agent,
          "input_schema",
        );

        const response = await fetch(inputSchemaUrl);

        if (!response.ok) {
          // Log HTTP errors (4xx/5xx)
          const errorMessage = `HTTP ${response.status}: ${response.statusText}`;

          logError(
            "http_error",
            "fetchInputSchema",
            agent,
            `Failed to fetch agent input schema: ${errorMessage}`,
            {
              status: response.status,
              statusText: response.statusText,
              url: inputSchemaUrl.toString(),
              headers: Object.fromEntries(response.headers.entries()),
            },
          );

          return Err(errorMessage);
        }

        let responseData: unknown;
        try {
          responseData = await response.json();
        } catch (jsonError) {
          // Log JSON parsing errors
          logError(
            "json_parse_error",
            "fetchInputSchema",
            agent,
            "Failed to parse JSON response from agent API",
            {
              status: response.status,
              url: inputSchemaUrl.toString(),
              contentType: response.headers.get("content-type"),
              error:
                jsonError instanceof Error
                  ? jsonError.message
                  : String(jsonError),
            },
          );

          return Err("Failed to parse JSON response");
        }

        const parsedResult = inputSchemaResponseSchema.safeParse(responseData);

        if (!parsedResult.success) {
          // Log schema validation errors
          logError(
            "schema_validation_error",
            "fetchInputSchema",
            agent,
            "Agent returned invalid input schema format",
            {
              issues: parsedResult.error.issues,
              // Sanitize the response data to avoid logging sensitive information
              responseDataKeys:
                responseData && typeof responseData === "object"
                  ? Object.keys(responseData)
                  : "non-object response",
            },
          );

          return Err("Failed to parse input schema");
        }

        const inputSchema = parsedResult.data;
        return Ok(inputSchema);
      } catch (err) {
        // Log network errors and other unexpected errors
        const errorMessage = err instanceof Error ? err.message : String(err);
        const isNetworkError =
          err instanceof Error &&
          (errorMessage.includes("fetch failed") ||
            errorMessage.includes("ECONNREFUSED") ||
            errorMessage.includes("ETIMEDOUT") ||
            errorMessage.includes("ENOTFOUND"));

        logError(
          "network_error",
          "fetchInputSchema",
          agent,
          "Network or unexpected error while fetching agent input schema",
          {
            message: errorMessage,
            type: isNetworkError ? "connection_failure" : "unknown",
          },
        );

        return Err(errorMessage);
      }
    },
  };
}
