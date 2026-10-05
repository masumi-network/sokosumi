import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import {
  getOAuthProviderState,
  type OAuthOptions,
} from "@better-auth/oauth-provider";
import type { DBAdapter, GenericEndpointContext } from "better-auth";
import { getOAuthState } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import type { Jwk, JwtOptions } from "better-auth/plugins/jwt";

import { moveClientSecretToBasicAuth } from "./auth-oauth-client-secret-shim";

export const oauthRefreshTokenOptions = {
  refreshTokenExpiresIn: 7_776_000, // 90 days (default: 2_592_000)
  // Refresh tokens rotate on every use, and reusing a rotated one revokes the
  // whole token family. CMO renews on several serverless instances, and the CLI
  // and Apple clients can refresh in parallel, so two requests often race on
  // the same token. For 30 seconds after rotation Core replays the same token
  // response instead of signing the person out (default: 0, off).
  refreshTokenReuseInterval: 30,
} satisfies Partial<OAuthOptions>;

/**
 * Revokes every access and refresh token the OAuth provider holds for a user,
 * across all clients. The provider's own logout path only revokes a session's
 * tokens and keeps `offline_access` refresh tokens (OIDC Back-Channel Logout
 * §2.7), so a client signed in with a stolen password would outlive the reset.
 * Same write as that path: rows are marked `revoked`, which the refresh grant
 * and Core's bearer check both refuse.
 */
export async function revokeUserOAuthTokens(
  adapter: Pick<DBAdapter, "updateMany">,
  userId: string,
) {
  const where = [
    { field: "userId", value: userId },
    { field: "revoked", operator: "eq" as const, value: null },
  ];
  const update = { revoked: new Date() };
  await Promise.all([
    adapter.updateMany({ model: "oauthAccessToken", where, update }),
    adapter.updateMany({ model: "oauthRefreshToken", where, update }),
  ]);
}

/** Production CMO's callback: marks the CMO client in a preview database. */
const CMO_PRODUCTION_CALLBACK =
  "https://app.cmo.xyz/api/auth/callback/sokosumi";

/** A CMO preview's branch alias, truncated with a hash when the branch is long. */
const CMO_PREVIEW_CALLBACK =
  /^https:\/\/sokosumi-cmo-git-[a-z0-9-]+\.preview\.cmo\.xyz\/api\/auth\/callback\/sokosumi$/;

/**
 * Preview Core only: lets the CMO client sign a CMO preview in at its own
 * callback, so a preview never needs its URI written into the preview
 * database (ADR 0045). Every other client and URI must match exactly.
 */
export function acceptCmoPreviewCallback(
  redirectUri: string,
  registeredUris: readonly string[],
  defaultResult: boolean,
): boolean {
  return (
    defaultResult ||
    (registeredUris.some((uri) => uri === CMO_PRODUCTION_CALLBACK) &&
      CMO_PREVIEW_CALLBACK.test(redirectUri))
  );
}

function withoutCreatePrompt(query: string): string {
  const params = new URLSearchParams(query);
  const prompts = (params.get("prompt") ?? "")
    .split(" ")
    .filter((prompt) => prompt && prompt !== "create");
  if (prompts.length) {
    params.set("prompt", prompts.join(" "));
  } else {
    params.delete("prompt");
  }
  return params.toString();
}

/**
 * A session that starts inside an OAuth request answers its `prompt=create`.
 * The provider's after hook then continues the request, but strips only
 * `login` (Better Auth 1.7.7), so `create` would send the new account back
 * to the sign-up page and round through `/oauth2/continue` before the
 * client. This runs first, after the provider verified the signed query,
 * and drops `create` from the request it continues.
 *
 * A renewed cookie also counts as a new session to Better Auth, and
 * `/oauth2/authorize` renews the session it reads. That session keeps its
 * id, and keeps the prompt, so a person already signed in is still asked
 * who to continue as.
 */
export async function answerCreatePromptWithNewSession(
  ctx: GenericEndpointContext,
): Promise<void> {
  const started = ctx.context.newSession;
  if (!started || started.session.id === ctx.context.session?.session.id) {
    return;
  }
  const oauthRequest = await getOAuthProviderState();
  if (oauthRequest?.query) {
    oauthRequest.query = withoutCreatePrompt(oauthRequest.query);
  }
  // A social sign-up carries the request through the provider's callback.
  const serverContext = (await getOAuthState())?.serverContext;
  if (typeof serverContext?.query === "string") {
    serverContext.query = withoutCreatePrompt(serverContext.query);
  }
}

type GetJwks = NonNullable<NonNullable<JwtOptions["adapter"]>["getJwks"]>;

/**
 * The signing keys this Core can decrypt. A database forked from production
 * (a preview, a Neon agent branch) holds production's keys, encrypted with a
 * secret this Core does not have, so signing an ID token fails. Leaving them
 * out lets Better Auth create a key of this Core's own.
 */
async function readDecryptableJwks(
  ctx: Parameters<GetJwks>[0],
): Promise<Jwk[]> {
  const keys = await ctx.context.adapter.findMany<Jwk>({ model: "jwks" });
  const decryptable = await Promise.all(
    keys.map((key) =>
      symmetricDecrypt({
        key: ctx.context.secretConfig,
        data: JSON.parse(key.privateKey),
      }).then(
        () => true,
        () => false,
      ),
    ),
  );
  const usable = keys.filter((_key, index) => decryptable[index]);
  if (usable.length < keys.length) {
    ctx.context.logger.warn(
      `Skipped ${keys.length - usable.length} JWKS signing key(s) encrypted with another secret`,
    );
  }
  return usable;
}

/**
 * Outside production, signing skips keys encrypted with another secret.
 * Production keeps the default key store: there an undecryptable key means
 * a wrong BETTER_AUTH_SECRET, and replacing the key would break every ID
 * token clients already hold, so it must fail loudly.
 */
export function jwtKeyStoreOptions(
  isProduction: boolean,
): Pick<JwtOptions, "adapter"> {
  return isProduction ? {} : { adapter: { getJwks: readDecryptableJwks } };
}

interface OAuthRefreshTokenBody {
  grant_type: "refresh_token";
  [key: string]: string | string[];
}

interface RefreshTokenRotation {
  rotatedAt: Date | null;
  rotationReplayExpiresAt: Date | null;
}

/**
 * Whether the provider rotated this refresh token and its replay window is
 * still open. `findRotation` receives the stored token: Better Auth's default
 * `storeTokens: "hashed"` keeps a SHA-256 base64url digest without the prefix.
 */
export async function isRefreshTokenRotating(
  refreshToken: string,
  prefix: string,
  findRotation: (storedToken: string) => Promise<RefreshTokenRotation | null>,
): Promise<boolean> {
  if (!refreshToken.startsWith(prefix)) return false;
  const rotation = await findRotation(
    createHash("sha256")
      .update(refreshToken.slice(prefix.length))
      .digest("base64url"),
  );
  return (
    !!rotation?.rotatedAt &&
    !!rotation.rotationReplayExpiresAt &&
    rotation.rotationReplayExpiresAt >= new Date()
  );
}

/**
 * Every request to Better Auth goes through here. A form `POST` to the token
 * endpoint is read once: a body secret moves into the header Better Auth
 * accepts (`auth-oauth-client-secret-shim`), and a refresh that lost a
 * rotation race is retried. Anything else goes to `handler` as it came.
 */
export async function handleOAuthTokenRequest(
  incoming: Request,
  handler: (request: Request) => Promise<Response>,
  retry: (body: OAuthRefreshTokenBody, request: Request) => Promise<Response>,
  isRotating: (refreshToken: string) => Promise<boolean>,
): Promise<Response> {
  if (
    incoming.method !== "POST" ||
    !new URL(incoming.url).pathname.endsWith("/oauth2/token") ||
    !incoming.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/x-www-form-urlencoded")
  ) {
    return handler(incoming);
  }

  const params = new URLSearchParams(await incoming.clone().text());
  const request = moveClientSecretToBasicAuth(incoming, params);
  if (
    params.get("grant_type") !== "refresh_token" ||
    params.has("client_assertion") ||
    request.headers.has("dpop")
  ) {
    return handler(request);
  }

  const resources = params.getAll("resource");
  const body: OAuthRefreshTokenBody = {
    ...Object.fromEntries(params),
    grant_type: "refresh_token",
    ...(resources.length > 1 ? { resource: resources } : {}),
  };
  let response = await handler(request.clone());
  // Better Auth 1.7.6 rejects the losing rotation claim before the winner
  // stores its replay. Re-enter its endpoint so authentication and the 30s
  // replay window remain enforced by the provider, across server instances.
  // Internal attempts use the validated API endpoint: the incoming HTTP
  // request has already passed the rate limiter and must only count once.
  // Bound recovery to five seconds if the winning worker never completes.
  // Better Auth returns the same error for expired tokens and client or scope
  // mismatches, so retry only while Core's row shows an open rotation.
  const refreshToken = params.get("refresh_token") ?? "";
  for (const delay of [25, 50, 100, 200, 400, 800, 1600, 1825]) {
    if (response.status !== 400) break;
    const error: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (
      !error ||
      typeof error !== "object" ||
      !("error" in error) ||
      error.error !== "invalid_grant" ||
      !("error_description" in error) ||
      error.error_description !== "invalid refresh token" ||
      !(await isRotating(refreshToken))
    ) {
      break;
    }
    await setTimeout(delay);
    response = await retry(body, request.clone());
  }
  return response;
}
