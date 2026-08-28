import { ssrfSafeFetch } from "@sokosumi/net";
import { err, ok, type Result } from "neverthrow";

import { hashCanonicalJsonValue, hashInputSchema } from "../hash/index.js";
import {
  type InputSchemaResponseSchemaType,
  type InputSchemaType,
  inputSchemaResponseSchema,
  type JobStatusResponseSchemaType,
  jobStatusResponseSchema,
  type ProvideInputRequestSchemaType,
  type ProvideInputResponseSchemaType,
  provideInputRequestSchema,
  provideInputResponseSchema,
  type StartFreeJobResponseSchemaType,
  type StartPaidJobResponseSchemaType,
  startFreeJobResponseSchema,
  startPaidJobResponseSchema,
} from "../schemas/index.js";
import type { Agent } from "../types/agent.js";
import { safeAddPathComponent } from "../utils/url.js";

/**
 * Configuration for the agent client.
 */
export interface AgentClientConfig {
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

interface AgentClientRequestOptions {
  signal?: AbortSignal;
}

/**
 * Why a `start_job` call failed, and — crucially — whether the seller is now
 * working on a job the caller will never record.
 *
 * `unreachable`: request validation failed before dispatch, or seller returned
 * an explicit non-timeout 4xx rejection. No seller-side job was accepted.
 *
 * `ambiguous`: transport failed after dispatch, or seller returned a timeout
 * or 5xx. Seller may have accepted the request, so callers must surface
 * possible stranded work.
 *
 * `invalid-response`: the seller answered 2xx with a body that does not match
 * the MIP-003 contract. It has accepted the job and started work, but the
 * caller cannot record it — MIP-003 has no cancel, so this strands the job and
 * must be surfaced rather than treated as a plain start failure.
 */
export interface AgentJobStartFailure {
  kind: "unreachable" | "ambiguous" | "invalid-response";
  message: string;
}

/** Failure phase for `provide_input`, with same retry-safety semantics as start_job. */
export type AgentJobInputFailure = AgentJobStartFailure;

function unreachable(message: string): AgentJobStartFailure {
  return { kind: "unreachable", message };
}

function ambiguous(message: string): AgentJobStartFailure {
  return { kind: "ambiguous", message };
}

function invalidResponse(message: string): AgentJobStartFailure {
  return { kind: "invalid-response", message };
}

function classifyStartJobHttpFailure(
  response: Response,
  message: string,
): AgentJobStartFailure {
  const detailedMessage = `${message} (status ${response.status})`;
  // Timeouts and 5xx: seller may have accepted before failing.
  if (response.status === 408 || response.status >= 500) {
    return ambiguous(detailedMessage);
  }
  // ssrfSafeFetch does not follow POST redirects; acceptance is unknown.
  if (response.status >= 300 && response.status < 400) {
    return ambiguous(detailedMessage);
  }
  // Explicit non-timeout 4xx: no seller-side job was accepted.
  if (response.status >= 400 && response.status < 500) {
    return unreachable(detailedMessage);
  }
  return ambiguous(detailedMessage);
}

/**
 * Creates an agent client with the provided configuration.
 */
export function createAgentClient(config?: AgentClientConfig) {
  function getAgentUrlWithPathComponent(
    agent: Agent,
    pathComponent: string,
  ): URL {
    const baseUrl = getAgentApiBaseUrl(agent);
    return safeAddPathComponent(baseUrl, pathComponent);
  }

  function getAgentApiBaseUrl(agent: Agent): URL {
    // Validate the API base URL
    const apiBaseUrl = new URL(agent.apiBaseUrl);
    if (apiBaseUrl.protocol !== "https:" && apiBaseUrl.protocol !== "http:") {
      throw new Error("Agent API base URL must be HTTP or HTTPS");
    }

    if (apiBaseUrl.search !== "") {
      throw new Error("Agent API base URL must not have a query string");
    }
    if (apiBaseUrl.hash !== "") {
      throw new Error("Agent API base URL must not have a hash");
    }

    // SSRF protection against private/loopback/link-local addresses is enforced
    // at connect time by `ssrfSafeFetch` (which resolves and filters the host),
    // so it also covers public hostnames that resolve to internal IPs.

    const usedUrl = agent.metadataOverride?.apiBaseUrl ?? agent.apiBaseUrl;
    const overrideUrl = new URL(usedUrl);

    // Also validate override URL if present
    if (overrideUrl.protocol !== "https:" && overrideUrl.protocol !== "http:") {
      throw new Error("Agent API base URL override must be HTTP or HTTPS");
    }

    if (overrideUrl.search !== "") {
      throw new Error(
        "Agent API base URL override must not have a query string",
      );
    }
    if (overrideUrl.hash !== "") {
      throw new Error("Agent API base URL override must not have a hash");
    }

    return overrideUrl;
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
    ): Promise<Result<StartPaidJobResponseSchemaType, AgentJobStartFailure>> {
      let startJobUrl: URL;
      try {
        startJobUrl = getAgentUrlWithPathComponent(agent, "start_job");
      } catch (error) {
        return err(unreachable(String(error)));
      }

      let startJobResponse: Response;
      try {
        startJobResponse = await ssrfSafeFetch(startJobUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            identifier_from_purchaser: identifierFromPurchaser,
            input_data: inputData,
          }),
        });
      } catch (error) {
        return err(ambiguous(String(error)));
      }

      if (!startJobResponse.ok) {
        return err(
          classifyStartJobHttpFailure(
            startJobResponse,
            "Failed to start agent job",
          ),
        );
      }
      // A 2xx means the seller accepted the job; every failure from here on
      // leaves it running on the seller's side.
      let responseJson: unknown;
      try {
        responseJson = await startJobResponse.json();
      } catch (error) {
        return err(
          invalidResponse(`start_job response was not valid JSON: ${error}`),
        );
      }

      const parsedResult = startPaidJobResponseSchema.safeParse(responseJson);
      if (!parsedResult.success) {
        return err(
          invalidResponse(
            `Failed to parse start job response: ${JSON.stringify(
              parsedResult.error,
            )}`,
          ),
        );
      }

      return ok(parsedResult.data);
    },

    async startFreeAgentJob(
      agent: Agent,
      inputData: InputSchemaType,
    ): Promise<Result<StartFreeJobResponseSchemaType, AgentJobStartFailure>> {
      let startJobUrl: URL;
      try {
        startJobUrl = getAgentUrlWithPathComponent(agent, "start_job");
      } catch (error) {
        return err(unreachable(String(error)));
      }

      let startJobResponse: Response;
      try {
        startJobResponse = await ssrfSafeFetch(startJobUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input_data: inputData,
          }),
        });
      } catch (error) {
        return err(ambiguous(String(error)));
      }

      if (!startJobResponse.ok) {
        return err(
          classifyStartJobHttpFailure(
            startJobResponse,
            "Failed to start free agent job",
          ),
        );
      }
      // A 2xx means the seller accepted the job; every failure from here on
      // leaves it running on the seller's side.
      let responseJson: unknown;
      try {
        responseJson = await startJobResponse.json();
      } catch (error) {
        return err(
          invalidResponse(`start_job response was not valid JSON: ${error}`),
        );
      }

      const parsedResult = startFreeJobResponseSchema.safeParse(responseJson);
      if (!parsedResult.success) {
        return err(
          invalidResponse(
            `Failed to parse start free job response: ${JSON.stringify(
              parsedResult.error,
            )}`,
          ),
        );
      }

      return ok(parsedResult.data);
    },

    async fetchAgentJobStatus(
      agent: Agent,
      jobId: string,
      options: AgentClientRequestOptions = {},
    ): Promise<
      Result<JobStatusResponseSchemaType & { statusHash: string }, string>
    > {
      try {
        const jobStatusUrl = getAgentUrlWithPathComponent(agent, "status");
        jobStatusUrl.searchParams.set("job_id", jobId);
        const jobStatusResponse = await ssrfSafeFetch(jobStatusUrl, {
          method: "GET",
          signal: options.signal,
        });

        if (!jobStatusResponse.ok) {
          return err(jobStatusResponse.statusText);
        }
        const responseJson = await jobStatusResponse.json();
        const parsedResult = jobStatusResponseSchema.safeParse(responseJson);

        if (!parsedResult.success) {
          return err("Failed to parse job status response");
        }
        const statusHash = hashCanonicalJsonValue(parsedResult.data);
        if (!statusHash) {
          return err("Failed to hash job status response");
        }

        return ok({
          ...parsedResult.data,
          statusHash,
        });
      } catch (error) {
        return err(String(error));
      }
    },

    async provideJobInput(
      agent: Agent,
      jobId: string,
      inputSchema: string,
      inputData: InputSchemaType,
    ): Promise<Result<ProvideInputResponseSchemaType, AgentJobInputFailure>> {
      let provideInputUrl: URL;
      try {
        provideInputUrl = getAgentUrlWithPathComponent(agent, "provide_input");
      } catch (error) {
        return err(unreachable(String(error)));
      }

      const inputSchemaHash = hashInputSchema(inputSchema);
      if (!inputSchemaHash) {
        return err(unreachable("Failed to hash input schema"));
      }

      const requestPayload: ProvideInputRequestSchemaType = {
        job_id: jobId,
        input_schema_hash: inputSchemaHash,
        input_data: inputData,
      };
      const parsedRequestPayload =
        provideInputRequestSchema.safeParse(requestPayload);
      if (!parsedRequestPayload.success) {
        return err(
          unreachable(
            `Failed to build provide input request: ${JSON.stringify(parsedRequestPayload.error)}`,
          ),
        );
      }
      const body = JSON.stringify(parsedRequestPayload.data);

      let provideInputResponse: Response;
      try {
        provideInputResponse = await ssrfSafeFetch(provideInputUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body,
        });
      } catch (error) {
        return err(ambiguous(String(error)));
      }

      if (!provideInputResponse.ok) {
        return err(
          classifyStartJobHttpFailure(
            provideInputResponse,
            "Failed to provide job input",
          ),
        );
      }

      let responseJson: unknown;
      try {
        responseJson = await provideInputResponse.json();
      } catch (error) {
        return err(
          invalidResponse(
            `provide_input response was not valid JSON: ${error}`,
          ),
        );
      }

      const parsedResult = provideInputResponseSchema.safeParse(responseJson);
      if (!parsedResult.success) {
        return err(
          invalidResponse(
            `Failed to parse provide input response: ${JSON.stringify(
              parsedResult.error,
            )}`,
          ),
        );
      }

      return ok(parsedResult.data);
    },

    async fetchAgentInputSchema(
      agent: Agent,
    ): Promise<Result<InputSchemaResponseSchemaType, string>> {
      try {
        const inputSchemaUrl = getAgentUrlWithPathComponent(
          agent,
          "input_schema",
        );

        const response = await ssrfSafeFetch(inputSchemaUrl);

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

          return err(errorMessage);
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

          return err("Failed to parse JSON response");
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

          return err("Failed to parse input schema");
        }

        const inputSchema = parsedResult.data;
        return ok(inputSchema);
      } catch (error) {
        // Log network errors and other unexpected errors
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const isNetworkError =
          error instanceof Error &&
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

        return err(errorMessage);
      }
    },
  };
}
