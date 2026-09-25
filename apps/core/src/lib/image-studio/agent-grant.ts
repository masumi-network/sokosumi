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
 *
 * Every grant names the surface it may be spent at. Without that, the token
 * Web mints for the *browser* — same format, same secret — was also a valid
 * credential at Core's agent surface, so a page could call the agent's own
 * endpoints directly and skip the agent entirely. An audience makes the two
 * non-interchangeable.
 */

const VERSION = "v2";

/**
 * Where a grant may be spent.
 *
 * `browser` — minted by Web, held by the page, accepted only by the agent's
 * HTTP channel. `agent` — minted by the agent, accepted only by Core's agent
 * surface. Neither is accepted in the other's place.
 */
export type AgentGrantAudience = "browser" | "agent";
const DEFAULT_TTL_SECONDS = 120;
const MAX_TTL_SECONDS = 600;

export interface AgentGrantClaims {
  userId: string;
  projectId: string;
  audience: AgentGrantAudience;
  /** Seconds since the epoch. */
  expiresAt: number;
}

function payloadOf(claims: AgentGrantClaims): string {
  return [
    VERSION,
    claims.audience,
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
    audience: AgentGrantAudience;
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
    audience: options.audience,
    expiresAt: Math.floor((options.now ?? new Date()).getTime() / 1000) + ttl,
  };
  const payload = payloadOf(claims);
  return `${payload}.${sign(payload, secret)}`;
}

export type AgentGrantResult =
  | { ok: true; claims: AgentGrantClaims }
  | { ok: false; reason: "malformed" | "signature" | "expired" | "audience" };

export function verifyAgentGrant(
  token: string,
  secret: string,
  /** The surface doing the verifying. A grant for elsewhere is refused. */
  audience: AgentGrantAudience,
  now: Date = new Date(),
): AgentGrantResult {
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== VERSION) {
    return { ok: false, reason: "malformed" };
  }
  const [, tokenAudience, userId, projectId, expiresAtRaw, signature] =
    parts as [string, string, string, string, string, string];
  const expiresAt = Number(expiresAtRaw);
  if (!userId || !projectId || !Number.isFinite(expiresAt)) {
    return { ok: false, reason: "malformed" };
  }
  if (tokenAudience !== "browser" && tokenAudience !== "agent") {
    return { ok: false, reason: "malformed" };
  }

  const expected = sign(
    payloadOf({
      userId,
      projectId,
      audience: tokenAudience,
      expiresAt,
    }),
    secret,
  );
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signature);
  if (
    expectedBytes.length !== actualBytes.length ||
    !crypto.timingSafeEqual(expectedBytes, actualBytes)
  ) {
    return { ok: false, reason: "signature" };
  }

  // Audience is compared only after the signature, so a wrong-surface token
  // is refused on its merits rather than telling an unauthenticated caller
  // which audience the endpoint wants.
  if (tokenAudience !== audience) {
    return { ok: false, reason: "audience" };
  }

  if (Math.floor(now.getTime() / 1000) >= expiresAt) {
    return { ok: false, reason: "expired" };
  }
  return {
    ok: true,
    claims: { userId, projectId, audience: tokenAudience, expiresAt },
  };
}
