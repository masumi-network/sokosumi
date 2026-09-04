import { randomBytes } from "node:crypto";

import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";

/** Prefix for third-party vendor Coworker API keys. */
export const COWORKER_API_KEY_PREFIX = "coworker_";
/** Prefix for newly issued Soko Bot API keys. */
export const SOKO_BOT_API_KEY_PREFIX = "sokoBot_";
/** Prefix on keys issued before the sokoBot_ rename. Still accepted at auth. */
export const LEGACY_SOKO_BOT_API_KEY_PREFIX = "orchestrator_";

export function isSokoBotApiKeyToken(token: string): boolean {
  return (
    token.startsWith(SOKO_BOT_API_KEY_PREFIX) ||
    token.startsWith(LEGACY_SOKO_BOT_API_KEY_PREFIX)
  );
}

/** Length of the stored key start used for display. */
export const COWORKER_API_KEY_START_LENGTH = COWORKER_API_KEY_PREFIX.length + 8;
export const SOKO_BOT_API_KEY_START_LENGTH = SOKO_BOT_API_KEY_PREFIX.length + 8;

const API_KEY_RANDOM_BYTES = 32;

/** Generates a third-party vendor Coworker API key token. */
export function generateCoworkerApiKeyToken(): string {
  return `${COWORKER_API_KEY_PREFIX}${randomBytes(API_KEY_RANDOM_BYTES).toString("base64url")}`;
}

/** Generates a Soko Bot API key token. */
export function generateSokoBotApiKeyToken(): string {
  return `${SOKO_BOT_API_KEY_PREFIX}${randomBytes(API_KEY_RANDOM_BYTES).toString("base64url")}`;
}

/** Hashes an agent API key token for storage and lookup. */
export async function hashApiKey(token: string): Promise<string> {
  const hash = await createHash("SHA-256").digest(
    new TextEncoder().encode(token),
  );
  return base64Url.encode(new Uint8Array(hash), { padding: false });
}
