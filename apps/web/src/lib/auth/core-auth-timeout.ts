/**
 * How long any web-to-Core auth request may take.
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
 */
export const CORE_AUTH_REQUEST_TIMEOUT_MS = 8000;
