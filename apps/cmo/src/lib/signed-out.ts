/**
 * Set when a person signs out of CMO. Their Sokosumi session outlives it, so
 * the next sign-in asks Sokosumi for a fresh one (`prompt=login`), where they
 * can use another email. The proxy drops it once someone is signed in.
 */
export const SIGNED_OUT_COOKIE = "cmo-signed-out";

/** As long as a Sokosumi session can last, so the question is never skipped. */
const SIGNED_OUT_MAX_AGE = 60 * 60 * 24 * 90;

/** The cookie's name, value and options, for `cookies().set(...)` in an action. */
export function signedOutCookie() {
  return [
    SIGNED_OUT_COOKIE,
    "1",
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SIGNED_OUT_MAX_AGE,
    },
  ] as const;
}
