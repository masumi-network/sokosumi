import type { Result } from "neverthrow";

import type {
  DesignMdDonePayload,
  DesignMdJobPayload,
  DesignMdSubmitInput,
} from "./schemas.js";

export interface DesignMdClientConfig {
  apiUrl?: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export interface DesignMdRequestOptions {
  signal?: AbortSignal;
}

export interface DesignMdGenerateUntilDoneInput extends DesignMdSubmitInput {
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

export interface DesignMdHttpError {
  type: "http_error";
  status: number;
  message: string;
}

export interface DesignMdJsonParseError {
  type: "json_parse_error";
  message: string;
}

export interface DesignMdSchemaValidationError {
  type: "schema_validation_error";
  message: string;
}

export interface DesignMdNetworkError {
  type: "network_error";
  message: string;
}

export interface DesignMdJobFailedError {
  type: "job_failed";
  message: string;
}

export type DesignMdClientError =
  | DesignMdHttpError
  | DesignMdJsonParseError
  | DesignMdSchemaValidationError
  | DesignMdNetworkError
  | DesignMdJobFailedError;

export interface DesignMdClient {
  submit(
    input: DesignMdSubmitInput,
    options?: DesignMdRequestOptions,
  ): Promise<Result<DesignMdJobPayload, DesignMdClientError>>;
  pollJob(
    jobId: string,
    options?: DesignMdRequestOptions,
  ): Promise<Result<DesignMdJobPayload, DesignMdClientError>>;
  generateUntilDone(
    input: DesignMdGenerateUntilDoneInput,
  ): Promise<Result<DesignMdDonePayload, DesignMdClientError>>;
}
