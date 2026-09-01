import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";

/**
 * Hashes an API key token (SHA-256 + base64url, no padding).
 * Shared by coworker and orchestrator key mint/verify paths.
 */
export async function hashApiKey(token: string): Promise<string> {
  const hash = await createHash("SHA-256").digest(
    new TextEncoder().encode(token),
  );
  return base64Url.encode(new Uint8Array(hash), { padding: false });
}
