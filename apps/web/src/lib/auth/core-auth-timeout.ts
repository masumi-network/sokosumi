/**
 * The default deadline for web-to-Core auth requests.
 *
 * 8s, not 5s. Production Core answers `/auth/get-session` in tens of
 * milliseconds, so this budget is only ever spent on a stall: a cold start, a
 * connection storm, a saturated web function. Five seconds turned those stalls
 * into "no session", and a session read that could not reach Core was reported
 * to the browser as a logout.
 *
 * One constant for both callers. `auth.server.ts` reads the session directly
 * and `auth.server.client.ts` drives the Better Auth client; they held separate
 * numbers under the same name, and raising one left the other at 5s.
 * Session lookup uses its separate startup budget below.
 */
export const CORE_AUTH_REQUEST_TIMEOUT_MS = 8000;

/**
 * Preview session responses took about 11s, including 9.7-10.2s before the
 * server began listening. Keep one bounded read with margin for that startup;
 * other auth operations retain the default deadline.
 */
export const CORE_AUTH_SESSION_READ_TIMEOUT_MS = 20_000;
