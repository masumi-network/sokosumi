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
 * `handleOAuthTokenRequest` calls this for every `POST …/oauth2/token` form
 * request. It rewrites one that carries a body secret and no Authorization
 * header into the Basic form Better Auth accepts: the secret moves from the
 * body into an `Authorization: Basic` header, and out of `params` too, so the
 * caller reads the request Better Auth gets. Everything else passes through
 * untouched, and client authentication itself stays entirely with Better Auth.
 *
 * Remove once all integrators authenticate with `client_secret_basic`.
 */
export function moveClientSecretToBasicAuth(
  request: Request,
  params: URLSearchParams,
): Request {
  if (request.headers.get("authorization")) {
    return request;
  }
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
