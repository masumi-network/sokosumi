export enum JobErrorCode {
  JOB_NOT_FOUND = "JOB_NOT_FOUND",
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
  AGENT_NOT_FOUND = "AGENT_NOT_FOUND",
  AGENT_UNAVAILABLE = "AGENT_UNAVAILABLE",
  AGENT_PRICING_NOT_FOUND = "AGENT_PRICING_NOT_FOUND",
  COST_TOO_HIGH = "COST_TOO_HIGH",
  PRICING_SCHEMA_MISMATCH = "PRICING_SCHEMA_MISMATCH",
  INPUT_HASH_MISMATCH = "INPUT_HASH_MISMATCH",
  AGENT_JOB_START_FAILED = "AGENT_JOB_START_FAILED",
  PURCHASE_CREATION_FAILED = "PURCHASE_CREATION_FAILED",
  JOB_NAME_GENERATION_FAILED = "JOB_NAME_GENERATION_FAILED",
  REFUND_REQUEST_FAILED = "REFUND_REQUEST_FAILED",
}

// Custom error class for job actions
export class JobError extends Error {
  code: JobErrorCode;
  constructor(code: JobErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "JobError";
  }
}

// Type guard for JobError
export function isJobError(error: unknown): error is JobError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    Object.values(JobErrorCode).includes(
      (error as { code?: unknown }).code as JobErrorCode,
    )
  );
}
