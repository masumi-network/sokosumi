/**
 * TEMPORARY compatibility shim for the OAuth2 token endpoint.
 *
 * Better Auth registers OAuth clients as `client_secret_basic` and hard-rejects
 * a `client_secret` sent in the form body (`client_secret_post`):
 * `400 invalid_client — "client registered for client_secret_basic cannot use
 * client_secret_post"`. Existing integrators (Serviceplan's agentic-coworkers,
 * pre plan-net/agentic-coworkers#2032) send the secret in the body, so every
 * token exchange failed and OAuth onboarding dead-ended at "No identity".
 *
 * This shim rewrites such requests into the Basic form Better Auth accepts:
 * secret moves from the body into an `Authorization: Basic` header. It only
 * touches `POST …/oauth2/token` form requests that carry a body secret and no
 * Authorization header — everything else passes through untouched, and client
 * authentication itself stays entirely with Better Auth.
 *
 * Remove once all integrators authenticate with `client_secret_basic`.
 */

const TOKEN_PATH_SUFFIX = "/oauth2/token";
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

export async function withClientSecretPostShim(
  request: Request,
): Promise<Request> {
  if (request.method !== "POST") {
    return request;
  }
  if (!new URL(request.url).pathname.endsWith(TOKEN_PATH_SUFFIX)) {
    return request;
  }
  if (request.headers.get("authorization")) {
    return request;
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes(FORM_CONTENT_TYPE)) {
    return request;
  }

  const params = new URLSearchParams(await request.clone().text());
  const clientId = params.get("client_id");
  const clientSecret = params.get("client_secret");
  if (!clientId || !clientSecret) {
    return request;
  }

  params.delete("client_secret");
  const headers = new Headers(request.headers);
  headers.set(
    "authorization",
    `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
  );
  headers.delete("content-length");

  return new Request(request.url, {
    method: "POST",
    headers,
    body: params.toString(),
  });
}
