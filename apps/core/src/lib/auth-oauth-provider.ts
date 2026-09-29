import { setTimeout } from "node:timers/promises";
import type { OAuthOptions } from "@better-auth/oauth-provider";

export const oauthRefreshTokenOptions = {
  refreshTokenExpiresIn: 7_776_000, // 90 days (default: 2_592_000)
  // Refresh tokens rotate on every use, and reusing a rotated one revokes the
  // whole token family. CMO renews on several serverless instances, and the CLI
  // and Apple clients can refresh in parallel, so two requests often race on
  // the same token. For 30 seconds after rotation Core replays the same token
  // response instead of signing the person out (default: 0, off).
  refreshTokenReuseInterval: 30,
} satisfies Partial<OAuthOptions>;

interface OAuthRefreshTokenBody {
  grant_type: "refresh_token";
  [key: string]: string | string[];
}

export async function handleOAuthRefreshTokenRequest(
  request: Request,
  handler: (request: Request) => Promise<Response>,
  retry: (body: OAuthRefreshTokenBody, request: Request) => Promise<Response>,
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
      error.error_description !== "invalid refresh token"
    ) {
      break;
    }
    await setTimeout(delay);
    response = await retry(body, request.clone());
  }
  return response;
}
