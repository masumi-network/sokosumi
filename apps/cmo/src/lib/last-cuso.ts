/**
 * The Cuso this device opened last, by his Project id, so CMO opens him
 * again when the address names none (ADR 0065). Per device, like the skipped
 * steps (ADR 0062); Sokosumi's preferred organization plays no part.
 */
export const LAST_CUSO_COOKIE = "cmo-last-cuso";

/** A year, like the skipped steps: a new device costs one pick. */
const LAST_CUSO_MAX_AGE = 60 * 60 * 24 * 365;

/** The cookie's name, value and options, for `cookies().set(...)` in an action or the proxy. */
export function lastCusoCookie(projectId: string) {
  return [
    LAST_CUSO_COOKIE,
    projectId,
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: LAST_CUSO_MAX_AGE,
    },
  ] as const;
}
