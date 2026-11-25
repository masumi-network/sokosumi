import { setTimeout } from "node:timers/promises";
import { hasRequestState } from "@better-auth/core/context";
import {
  getOAuthProviderState,
  type OAuthOptions,
} from "@better-auth/oauth-provider";
import {
  OAUTH_SCOPE_MCP,
  OAUTH_SCOPE_OFFLINE_ACCESS,
  OAUTH_SCOPE_OPENID,
} from "@sokosumi/utils";
import type { DBAdapter, GenericEndpointContext } from "better-auth";
import { APIError, getOAuthState } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import type { Jwk, JwtOptions } from "better-auth/plugins/jwt";

import { getEnv } from "@/config/env";

import { hashStoredOAuthToken } from "./auth-oauth-token-prefixes";

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
 * Open dynamic client registration (RFC 7591), so MCP clients such as Claude
 * Code and Claude.ai connect by URL (ADR 0076). Anyone can register, so a
 * registered client may ask only for the MCP server's scopes, never
 * `sokosumi:api`. `applyOAuthClientPolicy` links it to the MCP resource and
 * keeps `sokosumi:mcp` off clients made any other way.
 */
export function clientRegistrationOptions(mcpResourceIdentifier: string) {
  return {
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    // Better Auth stores this whole list on every registered client and
    // refuses a registration that asks for any other scope.
    clientRegistrationDefaultScopes: [
      OAUTH_SCOPE_OPENID,
      OAUTH_SCOPE_MCP,
      OAUTH_SCOPE_OFFLINE_ACCESS,
    ],
    // Allowed, not default: a default resource would also link every client
    // Web creates. The policy hook asks for it on each registration.
    clientRegistrationAllowedResources: [mcpResourceIdentifier],
    // A loopback or custom-scheme redirect, as Claude Code sends without an
    // `application_type`, makes a native client instead of a refused web one.
    clientRegistrationDefaultApplicationType: "infer",
    // Claude.ai registers every user from Anthropic's servers, so they share
    // one IP's allowance.
    rateLimit: { register: { window: 60, max: 60 } },
  } satisfies Partial<OAuthOptions<string[]>>;
}

/** Registration fields that serve confidential clients or back-channel logout. */
const UNREGISTRABLE_CLIENT_FIELDS = [
  "jwks",
  "jwks_uri",
  "backchannel_logout_uri",
  "backchannel_logout_session_required",
];

/** Links the consent page shows for a client. */
const CLIENT_INFO_URI_FIELDS = [
  "client_uri",
  "logo_uri",
  "tos_uri",
  "policy_uri",
];

/** Web's own client management, which must never grant `sokosumi:mcp`. */
const MANAGED_CLIENT_PATHS = new Set([
  "/oauth2/create-client",
  "/oauth2/update-client",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidClientMetadata(description: string): APIError {
  return new APIError("BAD_REQUEST", {
    error: "invalid_client_metadata",
    error_description: description,
  });
}

/**
 * Before hook for client management (ADR 0076). MCP access comes only through
 * self-registration, so Web's consent page always warns about an MCP client:
 * Web's create and update refuse `sokosumi:mcp`. A self-registered client is
 * public, with no secret and PKCE on every authorization (RFC 7591 §3.2.1 lets
 * the server replace a requested value), and is linked to the MCP resource.
 * Registration refuses keys, which only confidential clients use, back-channel
 * logout, which would have Core post logout tokens to a host anyone chose, and
 * any page link that is not https.
 */
export function applyOAuthClientPolicy(
  ctx: { path?: string; body?: unknown },
  mcpResourceIdentifier: string,
): { context: { body: Record<string, unknown> } } | undefined {
  const body = ctx.body;
  if (!isRecord(body)) return;

  if (ctx.path && MANAGED_CLIENT_PATHS.has(ctx.path)) {
    const metadata = ctx.path === "/oauth2/update-client" ? body.update : body;
    const scope = isRecord(metadata) ? metadata.scope : undefined;
    if (
      typeof scope === "string" &&
      scope.split(" ").includes(OAUTH_SCOPE_MCP)
    ) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_scope",
        error_description: `${OAUTH_SCOPE_MCP} is only for self-registered clients`,
      });
    }
    return;
  }
  if (ctx.path !== "/oauth2/register") return;

  const refused = UNREGISTRABLE_CLIENT_FIELDS.find((field) => field in body);
  if (refused) throw invalidClientMetadata(`${refused} cannot be registered`);
  const insecure = CLIENT_INFO_URI_FIELDS.find(
    (field) =>
      field in body &&
      !(
        typeof body[field] === "string" &&
        URL.canParse(body[field]) &&
        new URL(body[field]).protocol === "https:"
      ),
  );
  if (insecure) throw invalidClientMetadata(`${insecure} must be an https URL`);

  return {
    context: {
      body: {
        ...body,
        token_endpoint_auth_method: "none",
        resources: [mcpResourceIdentifier],
      },
    },
  };
}

/** The provider's endpoints that show a client to the sign-in and consent pages. */
const PUBLIC_CLIENT_PATHS = new Set([
  "/oauth2/public-client",
  "/oauth2/public-client-prelogin",
]);

/**
 * After hook: adds `selfRegistered` to the public client info, true when the
 * client came from open registration: nobody owns it (no `userId` or
 * `referenceId`), or it holds `sokosumi:mcp`, which only registration grants
 * (a signed-in user who registers becomes the owner). Web's consent page warns
 * about such an app, so a failed read answers true rather than an error. An error answer, such as 404
 * for an unknown client, passes through unchanged.
 */
export async function markSelfRegisteredClient(
  ctx: GenericEndpointContext & { context: { returned?: unknown } },
): Promise<Response | Record<string, unknown> | undefined> {
  const returned = ctx.context.returned;
  if (
    !PUBLIC_CLIENT_PATHS.has(ctx.path) ||
    !isRecord(returned) ||
    typeof returned.client_id !== "string"
  ) {
    return;
  }
  let selfRegistered = true;
  try {
    const client = await ctx.context.adapter.findOne<{
      userId?: string | null;
      referenceId?: string | null;
      scopes?: string[] | null;
    }>({
      model: "oauthClient",
      where: [{ field: "clientId", value: returned.client_id }],
    });
    selfRegistered =
      (!client?.userId && !client?.referenceId) ||
      Boolean(client?.scopes?.includes(OAUTH_SCOPE_MCP));
  } catch (error) {
    ctx.context.logger.error("Could not read the OAuth client's owner", error);
  }
  return ctx.json({ ...returned, selfRegistered });
}

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

/**
 * A CMO preview's branch alias, truncated with a hash when the branch is long.
 * Vercel names it after the project: `sokosumi-cmo`, being renamed `cmo-app`.
 * shortcut: accepts both names during the rename; drop `sokosumi-cmo` once no
 * open PR builds a preview from a branch made before the rename.
 */
const CMO_PREVIEW_CALLBACK =
  /^https:\/\/(?:sokosumi-cmo|cmo-app)-git-[a-z0-9-]+\.preview\.cmo\.xyz\/api\/auth\/callback\/sokosumi$/;

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
 * Where a sign-in inside an OAuth request holds the request's signed authorize
 * query, as `query`. Email code and password sign-ins send it back as the
 * signed `oauth_query`, which the OAuth provider keeps in its per-request
 * state. A social sign-in carries it through the provider's callback (and the
 * preview OAuth proxy) in the OAuth state's server context.
 */
async function authorizeQueryCarriers(): Promise<{ query?: unknown }[]> {
  const carriers = [
    await getOAuthProviderState(),
    (await getOAuthState())?.serverContext,
  ];
  return carriers.filter((carrier) => carrier != null);
}

/**
 * The signed authorize query of the OAuth request a sign-in runs inside, or
 * null outside one.
 */
export async function readOAuthAuthorizeQuery(): Promise<URLSearchParams | null> {
  if (!(await hasRequestState())) {
    return null;
  }
  for (const { query } of await authorizeQueryCarriers()) {
    if (typeof query === "string" && query) {
      return new URLSearchParams(query);
    }
  }
  return null;
}

/**
 * Whether the sign-in runs inside CMO's OAuth request, so what Core sends for
 * it carries CMO's name. CMO is its client id, never its redirect (ADR 0066).
 */
export async function signsInToCmo(): Promise<boolean> {
  const cmoClientId = getEnv().CMO_OAUTH_CLIENT_ID;
  if (!cmoClientId) {
    return false;
  }
  return (await readOAuthAuthorizeQuery())?.get("client_id") === cmoClientId;
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
  for (const carrier of await authorizeQueryCarriers()) {
    if (typeof carrier.query === "string") {
      carrier.query = withoutCreatePrompt(carrier.query);
    }
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
 * still open. `findRotation` receives the token as Better Auth stores it.
 */
export async function isRefreshTokenRotating(
  refreshToken: string,
  prefix: string,
  findRotation: (storedToken: string) => Promise<RefreshTokenRotation | null>,
): Promise<boolean> {
  if (!refreshToken.startsWith(prefix)) return false;
  const rotation = await findRotation(
    hashStoredOAuthToken(refreshToken, prefix),
  );
  return (
    !!rotation?.rotatedAt &&
    !!rotation.rotationReplayExpiresAt &&
    rotation.rotationReplayExpiresAt >= new Date()
  );
}

/**
 * `POST /oauth2/token`. A form request is read once, and a refresh that lost a
 * rotation race is retried. Anything else goes to `handler` as it came.
 */
export async function handleOAuthTokenRequest(
  request: Request,
  handler: (request: Request) => Promise<Response>,
  retry: (body: OAuthRefreshTokenBody, request: Request) => Promise<Response>,
  isRotating: (refreshToken: string) => Promise<boolean>,
): Promise<Response> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/x-www-form-urlencoded")
  ) {
    return handler(request);
  }

  const params = new URLSearchParams(await request.clone().text());
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
  // Better Auth 1.7.7 still rejects the losing rotation claim before the
  // winner stores its replay. Re-enter its endpoint so authentication and the 30s
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
