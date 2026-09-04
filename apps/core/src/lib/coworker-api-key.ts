import { randomBytes } from "node:crypto";

import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";

/** Prefix for third-party vendor Coworker API keys. */
export const COWORKER_API_KEY_PREFIX = "coworker_";
/** Prefix for Soko Bot Orchestrator API keys. */
export const ORCHESTRATOR_API_KEY_PREFIX = "orchestrator_";

/** Length of the stored key start used for display. */
export const COWORKER_API_KEY_START_LENGTH = COWORKER_API_KEY_PREFIX.length + 8;
export const ORCHESTRATOR_API_KEY_START_LENGTH =
  ORCHESTRATOR_API_KEY_PREFIX.length + 8;

const API_KEY_RANDOM_BYTES = 32;

/** Generates a third-party vendor Coworker API key token. */
export function generateCoworkerApiKeyToken(): string {
  return `${COWORKER_API_KEY_PREFIX}${randomBytes(API_KEY_RANDOM_BYTES).toString("base64url")}`;
}

/** Generates a Soko Bot Orchestrator API key token. */
export function generateOrchestratorApiKeyToken(): string {
  return `${ORCHESTRATOR_API_KEY_PREFIX}${randomBytes(API_KEY_RANDOM_BYTES).toString("base64url")}`;
}

/** Hashes an agent API key token for storage and lookup. */
export async function hashApiKey(token: string): Promise<string> {
  const hash = await createHash("SHA-256").digest(
    new TextEncoder().encode(token),
  );
  return base64Url.encode(new Uint8Array(hash), { padding: false });
}
