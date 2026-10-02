import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import type { OAuthOptions } from "@better-auth/oauth-provider";
import type { DBAdapter } from "better-auth";
import { APIError } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import type { Jwk, JwtOptions } from "better-auth/plugins/jwt";

export const OAUTH_ACCESS_TOKEN_PREFIX = "soko_access_token_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "soko_refresh_token_";

interface OAuthTokenAdapter extends Pick<DBAdapter, "findOne"> {
  transaction: <R>(
    callback: (
      tx: Pick<DBAdapter, "incrementOne" | "findOne" | "updateMany">,
    ) => Promise<R>,
  ) => Promise<R>;
}

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
  adapter: Pick<OAuthTokenAdapter, "transaction">,
  userId: string,
) {
  await adapter.transaction(async (tx) => {
    await lockOAuthUser(tx, userId);
    const where = [{ field: "userId", value: userId }];
    const revoked = new Date();
    // Rotated parents must also lose their replay and rotation marker. A
    // refresh already past its guarded rotation can still insert a successor;
    // the token after hook checks this marker under the same user lock.
    await tx.updateMany({
      model: "oauthRefreshToken",
      where,
      update: {
        revoked,
        rotatedAt: null,
        rotationReplayExpiresAt: null,
        rotationReplayResponse: null,
      },
    });
    await tx.updateMany({
      model: "oauthAccessToken",
      where,
      update: { revoked },
    });
  });
}

/** Better Auth consumes the reset link and writes the password before this. */
export async function revokePasswordResetCredentials(
  context: {
    adapter: Pick<OAuthTokenAdapter, "transaction">;
    internalAdapter: {
      deleteUserSessions: (userId: string) => Promise<unknown>;
    };
  },
  userId: string,
) {
  // Always attempt both. A failed token write must not leave sessions alive;
  // deleted sessions also fence authorization-code exchanges still in flight.
  try {
    await context.internalAdapter.deleteUserSessions(userId);
  } finally {
    await revokeUserOAuthTokens(context.adapter, userId);
  }
}

async function lockOAuthUser(
  adapter: Pick<DBAdapter, "incrementOne">,
  userId: string,
) {
  // Updating the timestamp locks the user until the transaction commits.
  // Both the sweep and token finalization acquire this lock before reading
  // token rows; a plain SELECT could see a pre-commit revocation under MVCC.
  await adapter.incrementOne({
    model: "user",
    where: [{ field: "id", value: userId }],
    increment: {},
    set: { updatedAt: new Date() },
  });
}

function storedOAuthToken(token: string, prefix: string) {
  return createHash("sha256")
    .update(token.startsWith(prefix) ? token.slice(prefix.length) : token)
    .digest("base64url");
}

interface IssuedOAuthToken {
  userId: string | null;
  sessionId: string | null;
  revoked: Date | null;
}

interface RefreshRevocation {
  revoked: Date | null;
  rotatedAt: Date | null;
}

/** Rejects and withdraws tokens minted concurrently with a user revocation. */
export async function guardOAuthTokenIssuance(
  adapter: OAuthTokenAdapter,
  body: Record<string, unknown> | undefined,
  returned: unknown,
) {
  if (
    !body ||
    !["refresh_token", "authorization_code"].includes(
      String(body.grant_type),
    ) ||
    !returned ||
    typeof returned !== "object" ||
    !("access_token" in returned) ||
    typeof returned.access_token !== "string"
  )
    return;
  const accessToken = storedOAuthToken(
    returned.access_token,
    OAUTH_ACCESS_TOKEN_PREFIX,
  );
  const where = [{ field: "token", value: accessToken }];
  const isJwt = returned.access_token.split(".").length === 3;
  const refreshWhere =
    "refresh_token" in returned && typeof returned.refresh_token === "string"
      ? [
          {
            field: "token",
            value: storedOAuthToken(
              returned.refresh_token,
              OAUTH_REFRESH_TOKEN_PREFIX,
            ),
          },
        ]
      : undefined;
  // Resource JWTs have no access-token row. Their refresh grant still has a
  // revocable row; identity-only JWTs without a refresh token are self-contained
  // and cannot authenticate Core's /v1 bearer path.
  if (isJwt && !refreshWhere) return;
  const issuedWhere = (isJwt && refreshWhere) || where;
  const issued = await adapter.findOne<IssuedOAuthToken>({
    model: isJwt ? "oauthRefreshToken" : "oauthAccessToken",
    where: issuedWhere,
  });
  const userId = issued?.userId;
  const valid = await adapter.transaction(async (tx) => {
    if (userId) await lockOAuthUser(tx, userId);
    const current = await tx.findOne<IssuedOAuthToken>({
      model: isJwt ? "oauthRefreshToken" : "oauthAccessToken",
      where: issuedWhere,
    });
    let cancelled = !userId || !current || !!current.revoked;
    if (
      body.grant_type === "refresh_token" &&
      typeof body.refresh_token === "string"
    ) {
      const parent = await tx.findOne<RefreshRevocation>({
        model: "oauthRefreshToken",
        where: [
          {
            field: "token",
            value: storedOAuthToken(
              body.refresh_token,
              OAUTH_REFRESH_TOKEN_PREFIX,
            ),
          },
        ],
      });
      cancelled ||= !parent || (!!parent.revoked && !parent.rotatedAt);
    } else {
      // Prisma clears sessionId when deletion wins before this hook reads it.
      cancelled ||=
        !current?.sessionId ||
        !(await tx.findOne({
          model: "session",
          where: [{ field: "id", value: current.sessionId }],
        }));
    }
    if (!cancelled) return true;
    await tx.updateMany({
      model: "oauthAccessToken",
      where,
      update: { revoked: new Date() },
    });
    if (refreshWhere) {
      await tx.updateMany({
        model: "oauthRefreshToken",
        where: refreshWhere,
        update: {
          revoked: new Date(),
          rotatedAt: null,
          rotationReplayExpiresAt: null,
          rotationReplayResponse: null,
        },
      });
    }
    return false;
  });
  // Throw after commit so cancellation writes are not rolled back.
  if (!valid)
    throw new APIError("BAD_REQUEST", {
      error: "invalid_grant",
      error_description: "grant revoked",
    });
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
  const rotation = await findRotation(storedOAuthToken(refreshToken, prefix));
  return (
    !!rotation?.rotatedAt &&
    !!rotation.rotationReplayExpiresAt &&
    rotation.rotationReplayExpiresAt >= new Date()
  );
}

export async function handleOAuthRefreshTokenRequest(
  request: Request,
  handler: (request: Request) => Promise<Response>,
  retry: (body: OAuthRefreshTokenBody, request: Request) => Promise<Response>,
  isRotating: (refreshToken: string) => Promise<boolean>,
): Promise<Response> {
  if (
    request.method !== "POST" ||
    !new URL(request.url).pathname.endsWith("/oauth2/token") ||
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/x-www-form-urlencoded") ||
    request.headers.has("dpop")
  ) {
    return handler(request);
  }

  const params = new URLSearchParams(await request.clone().text());
  if (
    params.get("grant_type") !== "refresh_token" ||
    params.has("client_assertion")
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
