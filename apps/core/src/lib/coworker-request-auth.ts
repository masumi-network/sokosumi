import { randomUUID } from "node:crypto";
import { signJWT } from "better-auth/plugins";
import { getEnv, isProductionEnvironment } from "@/config/env";
import { auth } from "@/lib/auth";
import { jwtKeyStoreOptions } from "@/lib/auth-oauth-provider";

const COWORKER_TOKEN_TYPE = "coworker+jwt";
const COWORKER_TOKEN_TTL_SECONDS = 300;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export interface SignCoworkerRequestTokenParams {
  coworkerBaseUrl: string;
  userId: string;
  organizationId?: string | null;
  coworkerSlug: string;
}

/**
 * Signs a short-lived EdDSA JWT proving Core originated a coworker API call
 * for this user, optional organization, and coworker (ADR 0078).
 */
export async function signCoworkerRequestToken(
  params: SignCoworkerRequestTokenParams,
): Promise<string> {
  const aud = params.coworkerBaseUrl.trim().replace(/\/+$/, "");
  const userId = params.userId.trim();
  const coworkerSlug = params.coworkerSlug.trim();
  const organizationId = params.organizationId?.trim() || undefined;

  if (!aud) {
    throw new Error("Coworker token signing requires coworkerBaseUrl");
  }
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(aud);
  } catch {
    throw new Error("Coworker token signing requires a valid coworkerBaseUrl");
  }
  const isHttps = parsedBaseUrl.protocol === "https:";
  const isLoopbackHttp =
    parsedBaseUrl.protocol === "http:" &&
    LOOPBACK_HOSTS.has(parsedBaseUrl.hostname);
  if (!isHttps && !isLoopbackHttp) {
    throw new Error(
      "Coworker token signing requires an https coworkerBaseUrl (http is allowed only for loopback hosts)",
    );
  }
  if (!userId) {
    throw new Error("Coworker token signing requires userId");
  }
  if (!coworkerSlug) {
    throw new Error("Coworker token signing requires coworkerSlug");
  }

  const context = await auth.$context;
  const { issuer } = await auth.api.getOpenIdConfig();
  const iat = Math.floor(Date.now() / 1000);

  return signJWT({ context } as Parameters<typeof signJWT>[0], {
    options: jwtKeyStoreOptions(isProductionEnvironment(getEnv())),
    header: { typ: COWORKER_TOKEN_TYPE },
    payload: {
      iss: issuer,
      aud,
      sub: userId,
      ...(organizationId ? { org: organizationId } : {}),
      coworker: coworkerSlug,
      iat,
      exp: iat + COWORKER_TOKEN_TTL_SECONDS,
      jti: randomUUID(),
    },
  });
}

/** Signs a fresh coworker request token and formats it as a Bearer header value. */
export async function getCoworkerAuthorizationHeader(
  params: SignCoworkerRequestTokenParams,
): Promise<string> {
  const token = await signCoworkerRequestToken(params);
  return `Bearer ${token}`;
}
