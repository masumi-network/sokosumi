import { err, ok } from "neverthrow";

import {
  DEFAULT_DESIGN_MD_API_URL,
  DEFAULT_DESIGN_MD_POLL_INTERVAL_MS,
} from "./constants.js";
import type { DesignMdJobPayload, DesignMdSubmitInput } from "./schemas.js";
import {
  designMdApiResponseSchema,
  isDesignMdJobInProgress,
} from "./schemas.js";
import type {
  DesignMdClient,
  DesignMdClientConfig,
  DesignMdClientError,
  DesignMdGenerateUntilDoneInput,
  DesignMdRequestOptions,
} from "./types.js";

function buildEndpoint(apiUrl: string, path: string): string {
  const baseUrl = new URL(apiUrl);
  const cleanPath = path.replace(/^\/+/, "");
  const cleanBasePath = baseUrl.pathname.replace(/\/+$/, "");

  baseUrl.pathname = cleanBasePath
    ? `${cleanBasePath}/${cleanPath}`
    : `/${cleanPath}`;

  return baseUrl.toString();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function createSchemaValidationError(message: string): DesignMdClientError {
  return {
    type: "schema_validation_error",
    message,
  };
}

async function parseDesignMdResponse(response: Response) {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch (error) {
    return err<DesignMdJobPayload, DesignMdClientError>({
      type: "json_parse_error",
      message: toErrorMessage(error),
    });
  }

  const parsed = designMdApiResponseSchema.safeParse(payload);

  if (!parsed.success) {
    return err<DesignMdJobPayload, DesignMdClientError>(
      createSchemaValidationError(parsed.error.message),
    );
  }

  return ok<DesignMdJobPayload, DesignMdClientError>(parsed.data);
}

async function requestDesignMdJob(
  fetchFn: typeof fetch,
  url: string,
  apiKey: string,
  init: Omit<RequestInit, "headers">,
) {
  let response: Response;

  try {
    response = await fetchFn(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return err<DesignMdJobPayload, DesignMdClientError>({
      type: "network_error",
      message: toErrorMessage(error),
    });
  }

  if (!response.ok) {
    return err<DesignMdJobPayload, DesignMdClientError>({
      type: "http_error",
      status: response.status,
      message: `Masumi DESIGN.md API responded with ${response.status}`,
    });
  }

  return parseDesignMdResponse(response);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Operation aborted"));
      return;
    }

    const timeout = setTimeout(resolve, ms);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new Error("Operation aborted"));
      },
      { once: true },
    );
  });
}

function getFailedJobMessage(payload: DesignMdJobPayload): string {
  if (payload.status !== "failed") return "DESIGN.md job failed";
  return payload.error ?? payload.message ?? "DESIGN.md job failed";
}

export function createDesignMdClient({
  apiUrl = DEFAULT_DESIGN_MD_API_URL,
  apiKey,
  fetch: fetchFn = fetch,
}: DesignMdClientConfig): DesignMdClient {
  const designMdUrl = buildEndpoint(apiUrl, "design-md");

  return {
    async submit(
      input: DesignMdSubmitInput,
      options: DesignMdRequestOptions = {},
    ) {
      const body =
        input.force === undefined
          ? { url: input.url }
          : { url: input.url, force: input.force };

      return requestDesignMdJob(fetchFn, designMdUrl, apiKey, {
        method: "POST",
        body: JSON.stringify(body),
        signal: options.signal,
      });
    },

    async pollJob(jobId: string, options: DesignMdRequestOptions = {}) {
      return requestDesignMdJob(
        fetchFn,
        buildEndpoint(designMdUrl, `jobs/${jobId}`),
        apiKey,
        {
          method: "GET",
          signal: options.signal,
        },
      );
    },

    async generateUntilDone(input: DesignMdGenerateUntilDoneInput) {
      const submitResult = await this.submit(
        { url: input.url, force: input.force },
        { signal: input.signal },
      );

      if (submitResult.isErr()) return err(submitResult.error);

      let payload = submitResult.value;
      const pollIntervalMs =
        input.pollIntervalMs ?? DEFAULT_DESIGN_MD_POLL_INTERVAL_MS;

      while (isDesignMdJobInProgress(payload)) {
        try {
          await wait(pollIntervalMs, input.signal);
        } catch (error) {
          return err<never, DesignMdClientError>({
            type: "network_error",
            message: toErrorMessage(error),
          });
        }

        const pollResult = await this.pollJob(payload.jobId, {
          signal: input.signal,
        });

        if (pollResult.isErr()) return err(pollResult.error);
        payload = pollResult.value;
      }

      if (payload.status === "failed") {
        return err({
          type: "job_failed",
          message: getFailedJobMessage(payload),
        });
      }

      return ok(payload);
    },
  };
}
