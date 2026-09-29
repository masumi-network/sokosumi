import { getAuth } from "../../../../lib/auth";

/**
 * Better Auth serves these to the browser. CMO is a confidential client:
 * renewal calls the auth handler in-process and must not hand the tokens out.
 */
const BROWSER_TOKEN_PATHS = new Set([
  "/api/auth/get-access-token",
  "/api/auth/refresh-token",
  "/api/auth/account-info",
]);

function handler(request: Request): Promise<Response> | Response {
  if (BROWSER_TOKEN_PATHS.has(new URL(request.url).pathname)) {
    return new Response(null, { status: 404 });
  }
  return getAuth().handler(request);
}

export { handler as GET, handler as POST };
