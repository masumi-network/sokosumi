import { randomBytes } from "node:crypto";

/** Prefix for first-party Soko Bot / PA orchestrator API keys. Never `orch_`. */
export const ORCHESTRATOR_API_KEY_PREFIX = "orchestrator_";

/** Length of the key start stored for display (prefix + 8 chars). */
export const ORCHESTRATOR_API_KEY_START_LENGTH =
  ORCHESTRATOR_API_KEY_PREFIX.length + 8;

const ORCHESTRATOR_API_KEY_RANDOM_BYTES = 32;

/** Generates a dedicated orchestrator API key token bound to a Soko Bot. */
export function generateOrchestratorApiKeyToken(): string {
  return `${ORCHESTRATOR_API_KEY_PREFIX}${randomBytes(
    ORCHESTRATOR_API_KEY_RANDOM_BYTES,
  ).toString("base64url")}`;
}
