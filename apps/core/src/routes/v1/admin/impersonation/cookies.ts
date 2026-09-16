import type { Context } from "hono";

import { internalServerError } from "@/helpers/error";

/**
 * Forwards Better Auth session cookies from a wrapper call to the browser so
 * it adopts the switched session. Fails loudly when none come back: without
 * them the browser would keep its old session while the audit claims a
 * switch.
 */
export function forwardSessionCookies(c: Context, headers: Headers) {
  const cookies = headers.getSetCookie();

  if (cookies.length === 0) {
    throw internalServerError("Impersonation did not return a session");
  }

  for (const cookie of cookies) {
    c.header("Set-Cookie", cookie, { append: true });
  }
}
