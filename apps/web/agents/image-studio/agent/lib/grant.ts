import crypto from "node:crypto";

/**
 * The grant the studio agent presents to Core.
 *
 * Deliberately the same wire format Core verifies
 * (`apps/core/src/lib/image-studio/agent-grant.ts`). Two small HMAC helpers
 * rather than a shared package: the agent compiles as its own service and a
 * workspace import would drag Core's module graph into it, which is precisely
 * what the studio agent must not have.
 *
 * A grant names a user and a project. It is not permission — Core re-reads
 * that user's current project membership on every call, so a grant minted a
 * moment before a removal stops working immediately.
 */

const VERSION = "v1";
const TTL_SECONDS = 120;

function secret(): string {
  const value = process.env.IMAGE_STUDIO_AGENT_SECRET;
  if (!value || value.length < 32) {
    throw new Error("IMAGE_STUDIO_AGENT_SECRET is not configured");
  }
  return value;
}

export function mintGrant(claims: {
  userId: string;
  projectId: string;
}): string {
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = [
    VERSION,
    claims.userId,
    claims.projectId,
    String(expiresAt),
  ].join(".");
  const signature = crypto
    .createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export interface GrantClaims {
  userId: string;
  projectId: string;
}

/** Verifies a token minted by Web for the browser. Same format, same secret. */
export function verifyGrant(token: string): GrantClaims | null {
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) return null;
  const [, userId, projectId, expiresAtRaw, signature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const expiresAt = Number(expiresAtRaw);
  if (!userId || !projectId || !Number.isFinite(expiresAt)) return null;

  const expected = crypto
    .createHmac("sha256", secret())
    .update([VERSION, userId, projectId, expiresAtRaw].join("."))
    .digest("base64url");
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signature);
  if (
    expectedBytes.length !== actualBytes.length ||
    !crypto.timingSafeEqual(expectedBytes, actualBytes)
  ) {
    return null;
  }
  if (Math.floor(Date.now() / 1000) >= expiresAt) return null;
  return { userId, projectId };
}
