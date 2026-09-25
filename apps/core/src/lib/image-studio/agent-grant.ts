import crypto from "node:crypto";

/**
 * The credential the image-studio agent presents to Core.
 *
 * A grant says only "this turn is acting as user U inside project P, and it
 * was minted before T". It is *not* an authorization: Core still calls
 * `requireProjectAccessForUser` afterwards, so a grant minted while the user
 * was a member stops working the moment the membership is gone.
 *
 * Shared-secret HMAC rather than a key pair: both ends are ours, they deploy
 * together, and ADR 0007 singled out per-network key material as a cost worth
 * avoiding.
 */

const VERSION = "v1";
const DEFAULT_TTL_SECONDS = 120;
const MAX_TTL_SECONDS = 600;

export interface AgentGrantClaims {
  userId: string;
  projectId: string;
  /** Seconds since the epoch. */
  expiresAt: number;
}

function payloadOf(claims: AgentGrantClaims): string {
  return [
    VERSION,
    claims.userId,
    claims.projectId,
    String(claims.expiresAt),
  ].join(".");
}

function sign(payload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

export function mintAgentGrant(
  options: {
    userId: string;
    projectId: string;
    ttlSeconds?: number;
    now?: Date;
  },
  secret: string,
): string {
  const ttl = Math.min(
    options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    MAX_TTL_SECONDS,
  );
  const claims: AgentGrantClaims = {
    userId: options.userId,
    projectId: options.projectId,
    expiresAt: Math.floor((options.now ?? new Date()).getTime() / 1000) + ttl,
  };
  const payload = payloadOf(claims);
  return `${payload}.${sign(payload, secret)}`;
}

export type AgentGrantResult =
  | { ok: true; claims: AgentGrantClaims }
  | { ok: false; reason: "malformed" | "signature" | "expired" };

export function verifyAgentGrant(
  token: string,
  secret: string,
  now: Date = new Date(),
): AgentGrantResult {
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) {
    return { ok: false, reason: "malformed" };
  }
  const [, userId, projectId, expiresAtRaw, signature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const expiresAt = Number(expiresAtRaw);
  if (!userId || !projectId || !Number.isFinite(expiresAt)) {
    return { ok: false, reason: "malformed" };
  }

  const expected = sign(payloadOf({ userId, projectId, expiresAt }), secret);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signature);
  if (
    expectedBytes.length !== actualBytes.length ||
    !crypto.timingSafeEqual(expectedBytes, actualBytes)
  ) {
    return { ok: false, reason: "signature" };
  }

  if (Math.floor(now.getTime() / 1000) >= expiresAt) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, claims: { userId, projectId, expiresAt } };
}
