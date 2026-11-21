import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { z } from "@hono/zod-openapi";
import { getEnv } from "@/config/env";

/**
 * The credential a sandboxed turn uses to call Core. It names one turn and
 * one session and expires with the turn, so whatever reads it inside the
 * sandbox can do no more than the turn already may. The runner never sees it:
 * the sandbox network proxy adds it to requests bound for Core.
 */
export interface TurnTokenClaims {
  turnId: string;
  sessionId: string;
  reconciliationLeaseToken?: string;
  /** Unix milliseconds. */
  expiresAt: number;
}

const claimsSchema = z.object({
  turnId: z.string().min(1),
  sessionId: z.string().min(1),
  reconciliationLeaseToken: z.string().min(1).optional(),
  expiresAt: z.number().int(),
});

function signingKey(): Buffer {
  // Derived rather than reused: a token forged from this key opens nothing
  // Better Auth signs, and the key needs no separate provisioning.
  return Buffer.from(
    hkdfSync(
      "sha256",
      getEnv().BETTER_AUTH_SECRET,
      "sokosumi",
      "soko-bot-turn-token-v1",
      32,
    ),
  );
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function issueTurnToken(claims: TurnTokenClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * The claims of a valid token for `turnId` unexpired at `now()` (Unix
 * milliseconds), or null. `expiresAt` comes from the turn's PostgreSQL-time
 * deadline, so callers pass PostgreSQL time. `now` is read only for a token
 * whose signature and turn already check out.
 */
export async function verifyTurnToken(
  token: string | undefined,
  turnId: string,
  now: () => Promise<number>,
): Promise<TurnTokenClaims | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return null;
  let claims: TurnTokenClaims;
  try {
    const parsed = claimsSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (!parsed.success) return null;
    claims = parsed.data;
  } catch {
    return null;
  }
  if (claims.turnId !== turnId) return null;
  return claims.expiresAt > (await now()) ? claims : null;
}
