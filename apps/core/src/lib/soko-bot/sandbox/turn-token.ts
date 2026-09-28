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
  /** Unix milliseconds. */
  expiresAt: number;
}

const claimsSchema = z.object({
  turnId: z.string().min(1),
  sessionId: z.string().min(1),
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

/** The claims of a valid, unexpired token for `turnId`, or null. */
export function verifyTurnToken(
  token: string | undefined,
  turnId: string,
): TurnTokenClaims | null {
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
  return claims.turnId === turnId && claims.expiresAt > Date.now()
    ? claims
    : null;
}
