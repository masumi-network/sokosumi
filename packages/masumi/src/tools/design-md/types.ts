import type { Result } from "neverthrow";

import type { DesignMdJobPayload, DesignMdSubmitInput } from "./schemas.js";

export interface DesignMdClientConfig {
  apiUrl?: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export interface DesignMdRequestOptions {
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

export type DesignMdClientError =
  | DesignMdHttpError
  | DesignMdJsonParseError
  | DesignMdSchemaValidationError
  | DesignMdNetworkError;

export interface DesignMdClient {
  submit(
    input: DesignMdSubmitInput,
    options?: DesignMdRequestOptions,
  ): Promise<Result<DesignMdJobPayload, DesignMdClientError>>;
  pollJob(
    jobId: string,
    options?: DesignMdRequestOptions,
  ): Promise<Result<DesignMdJobPayload, DesignMdClientError>>;
}
