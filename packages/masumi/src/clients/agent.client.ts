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
 * Validates that a hostname is not an internal/private address to prevent SSRF attacks.
 * Blocks localhost, loopback, private IP ranges, link-local, and multicast addresses.
 */
function isInternalHostname(hostname: string): boolean {
  // Check for localhost and loopback
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("127.") ||
    hostname === "[::1]"
  ) {
    return true;
  }

  // Try to parse as IP address
  try {
    // Handle IPv6 addresses in brackets
    const ipString =
      hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1)
        : hostname;

    // Check if it's a valid IP address
    const parts = ipString.split(".");
    if (parts.length === 4) {
      // IPv4 address
      const [a, b, _c, _d] = parts.map((p) => parseInt(p, 10));

      // Check for invalid parts
      if (
        parts.some(
          (p) =>
            Number.isNaN(parseInt(p, 10)) ||
            parseInt(p, 10) < 0 ||
            parseInt(p, 10) > 255,
        )
      ) {
        return false; // Not a valid IP, might be a hostname
      }

      // Block 0.0.0.0/8 (SSRF bypass - resolves to localhost on Unix systems)
      if (a === 0) {
        return true;
      }

      // Private IP ranges (RFC 1918)
      // 10.0.0.0/8
      if (a === 10) {
        return true;
      }
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) {
        return true;
      }
      // 192.168.0.0/16
      if (a === 192 && b === 168) {
        return true;
      }

      // Link-local addresses (169.254.0.0/16) - includes cloud metadata endpoints
      if (a === 169 && b === 254) {
        return true;
      }

      // Loopback (127.0.0.0/8)
      if (a === 127) {
        return true;
      }

      // Multicast (224.0.0.0/4)
      if (a >= 224 && a <= 239) {
        return true;
      }

      // Reserved for future use (240.0.0.0/4)
      if (a >= 240 && a <= 255) {
        return true;
      }
    } else if (ipString.includes(":")) {
      // IPv6 address
      // Block IPv6 unspecified address :: (SSRF bypass - resolves to localhost on Unix systems)
      if (ipString === "::" || ipString === "0:0:0:0:0:0:0:0") {
        return true;
      }
      // Check for IPv6 loopback
      if (ipString === "::1" || ipString === "0:0:0:0:0:0:0:1") {
        return true;
      }

      // Check for IPv6 private ranges
      // fc00::/7 (unique local addresses)
      if (ipString.startsWith("fc") || ipString.startsWith("fd")) {
        return true;
      }

      // fe80::/10 (link-local)
      if (
        ipString.startsWith("fe8") ||
        ipString.startsWith("fe9") ||
        ipString.startsWith("fea") ||
        ipString.startsWith("feb")
      ) {
        return true;
      }

      // ::ffff:0:0/96 (IPv4-mapped IPv6 addresses)
      if (ipString.startsWith("::ffff:")) {
        const ipv4Part = ipString.substring(7);
        // WHATWG URL parser normalizes IPv4-mapped addresses to hex groups
        // e.g., ::ffff:127.0.0.1 becomes ::ffff:7f00:1
        // Convert hex groups back to decimal IPv4 format
        if (ipv4Part.includes(":")) {
          // Hex format: convert to decimal IPv4
          const hexParts = ipv4Part.split(":");
          if (hexParts.length === 2) {
            // Format: 7f00:1 -> 127.0.0.1
            const upper = parseInt(hexParts[0], 16);
            const lower = parseInt(hexParts[1], 16);
            const a = (upper >> 8) & 0xff;
            const b = upper & 0xff;
            const c = (lower >> 8) & 0xff;
            const d = lower & 0xff;
            return isInternalHostname(`${a}.${b}.${c}.${d}`);
          }
        }
        return isInternalHostname(ipv4Part);
      }
    }
  } catch {
    // Not a valid IP address, treat as hostname
    // Additional hostname checks can go here if needed
  }

  return false;
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

    // SSRF protection: block internal/private hostnames
    if (isInternalHostname(apiBaseUrl.hostname)) {
      throw new Error(
        "Agent API base URL must not point to internal or private addresses",
      );
    }

    const usedUrl = agent.overrideApiBaseUrl ?? agent.apiBaseUrl;
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

    if (isInternalHostname(overrideUrl.hostname)) {
      throw new Error(
        "Agent API base URL override must not point to internal or private addresses",
      );
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
          return err("Failed to start agent job");
        }
        const responseJson = await startJobResponse.json();

        const parsedResult = startPaidJobResponseSchema.safeParse(responseJson);
        if (!parsedResult.success) {
          return err(
            `Failed to parse start job response: ${JSON.stringify(
              parsedResult.error,
            )}`,
          );
        }

        return ok(parsedResult.data);
      } catch (error) {
        return err(String(error));
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
          return err("Failed to start free agent job");
        }
        const responseJson = await startJobResponse.json();

        const parsedResult = startFreeJobResponseSchema.safeParse(responseJson);
        if (!parsedResult.success) {
          return err(
            `Failed to parse start free job response: ${JSON.stringify(
              parsedResult.error,
            )}`,
          );
        }

        return ok(parsedResult.data);
      } catch (error) {
        return err(String(error));
      }
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
        const jobStatusResponse = await fetch(jobStatusUrl, {
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
    ): Promise<Result<ProvideInputResponseSchemaType, string>> {
      try {
        const provideInputUrl = getAgentUrlWithPathComponent(
          agent,
          "provide_input",
        );

        const inputSchemaHash = hashInputSchema(inputSchema);
        if (!inputSchemaHash) {
          return err("Failed to hash input schema");
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
            `Failed to build provide input request: ${JSON.stringify(parsedRequestPayload.error)}`,
          );
        }
        const body = JSON.stringify(parsedRequestPayload.data);

        const provideInputResponse = await fetch(provideInputUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body,
        });

        if (!provideInputResponse.ok) {
          return err(
            `Failed to provide job input: ${provideInputResponse.status} ${provideInputResponse.statusText}`,
          );
        }
        const responseJson = await provideInputResponse.json();
        const parsedResult = provideInputResponseSchema.safeParse(responseJson);
        if (!parsedResult.success) {
          return err(
            `Failed to parse provide input response: ${JSON.stringify(
              parsedResult.error,
            )}`,
          );
        }

        return ok(parsedResult.data);
      } catch (error) {
        return err(String(error));
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
