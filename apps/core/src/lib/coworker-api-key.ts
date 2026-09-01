import { randomBytes } from "node:crypto";

/** Prefix for dedicated coworker API key tokens. Must match in CLI and auth. */
export const COWORKER_API_KEY_PREFIX = "coworker_";

/** Length of the key start stored for display (prefix + 8 chars). */
export const COWORKER_API_KEY_START_LENGTH = COWORKER_API_KEY_PREFIX.length + 8;

const COWORKER_API_KEY_RANDOM_BYTES = 32;

/** Generates a dedicated coworker API key token. */
export function generateCoworkerApiKeyToken(): string {
  return `${COWORKER_API_KEY_PREFIX}${randomBytes(
    COWORKER_API_KEY_RANDOM_BYTES,
  ).toString("base64url")}`;
}
