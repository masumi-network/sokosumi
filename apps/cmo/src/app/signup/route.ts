import { normalizeWebsiteUrl } from "@sokosumi/utils";

import { getAuth, sokosumiSignInRedirect } from "../../lib/auth";
import { keptWebsiteSetCookie } from "../../lib/kept-website";

/**
 * Create account from a link, such as a button on cmo.xyz or an email. The
 * website comes first: a link without one asks for it on /start, and a link
 * with one keeps it, so reading starts the moment the founder is back.
 */
export async function GET(request: Request): Promise<Response> {
  const website = normalizeWebsiteUrl(
    new URL(request.url).searchParams.get("url") ?? "",
  );
  if (!website) {
    return new Response(null, {
      status: 302,
      headers: {
        location: new URL("/start", request.url).href,
        "cache-control": "no-store",
      },
    });
  }
  const response = await sokosumiSignInRedirect(getAuth(), request, {
    createAccount: true,
  });
  // A prefetch starts nothing (403), so it keeps nothing either.
  if (response.status === 302) {
    response.headers.append("set-cookie", keptWebsiteSetCookie(website));
  }
  return response;
}
