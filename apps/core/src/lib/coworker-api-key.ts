import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";

/** Prefix for dedicated coworker API key tokens. Must match in CLI and auth. */
export const COWORKER_API_KEY_PREFIX = "coworker_";

/** Length of the key start stored for display (prefix + 8 chars). */
export const COWORKER_API_KEY_START_LENGTH = COWORKER_API_KEY_PREFIX.length + 8;

/**
 * Hashes a coworker API key token (SHA-256 + base64url, no padding).
 * Single source of truth for key creation (CLI) and verification (auth middleware).
 */
export async function hashCoworkerApiKey(token: string): Promise<string> {
  const hash = await createHash("SHA-256").digest(
    new TextEncoder().encode(token),
  );
  return base64Url.encode(new Uint8Array(hash), { padding: false });
}
