import { randomBytes } from "node:crypto";

import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";

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

/**
 * Hashes a coworker API key token (SHA-256 + base64url, no padding).
 * Single source of truth for key creation and verification.
 */
export async function hashApiKey(token: string): Promise<string> {
  const hash = await createHash("SHA-256").digest(
    new TextEncoder().encode(token),
  );
  return base64Url.encode(new Uint8Array(hash), { padding: false });
}
