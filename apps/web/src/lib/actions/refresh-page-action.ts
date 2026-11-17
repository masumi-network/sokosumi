"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { hasSessionCookie } from "@/lib/auth/session-cookie";

/**
 * Renders the open page again and keeps every page prefetched for the next
 * click. `router.refresh()` drops those pages, and Next then loads only
 * their shell. It reads nothing beyond what the page's own render reads, and
 * it returns a flag, not an `ActionResultDto`: the reader sees no result.
 *
 * Without a session cookie the proxy redirects the action's POST to
 * `/signin`. Most likely that ends in an error the caller catches. If the
 * action still runs there, a refresh could render the sign-in page under the
 * current URL, so it returns false instead. Either way the caller refreshes
 * with a GET, which the proxy redirects to sign-in.
 */
export async function refreshPage(): Promise<boolean> {
  if (!hasSessionCookie(await headers())) return false;
  refresh();
  return true;
}
