import { getEnvSecrets, redactSecrets } from "./secret-redaction.js";

export const MAX_UPSTREAM_ERROR_LOG_LENGTH = 2_000;
const TRUNCATED_SUFFIX = "... [truncated]";

/** Redact the complete message before limiting the text sent to stdout. */
export function formatUpstreamErrorForLog(message: string): string {
  const redacted = redactSecrets(message, getEnvSecrets());
  if (redacted.length <= MAX_UPSTREAM_ERROR_LOG_LENGTH) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_UPSTREAM_ERROR_LOG_LENGTH - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`;
}
