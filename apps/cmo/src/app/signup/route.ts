import { normalizeWebsiteUrl } from "@sokosumi/utils";

import { getAuth, sokosumiSignInRedirect } from "../../lib/auth";

/**
 * Create account from a link, such as a button on cmo.xyz or an email. The
 * website comes first: a link without one asks for it on /start, carrying the
 * link's other parameters as the sign-up context. A link with one goes on to
 * Sokosumi, and its website fills the hiring form on return.
 */
export async function GET(request: Request): Promise<Response> {
  const link = new URL(request.url);
  if (!normalizeWebsiteUrl(link.searchParams.get("url") ?? "")) {
    const start = new URL("/start", link);
    start.search = link.search;
    return new Response(null, {
      status: 302,
      headers: { location: start.href, "cache-control": "no-store" },
    });
  }
  return sokosumiSignInRedirect(getAuth(), request, { createAccount: true });
}
