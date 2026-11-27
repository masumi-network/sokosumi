/**
 * How long any web-to-Core auth request may take.
 *
 * 12s. Warm Core answers `/auth/get-session` in tens of milliseconds, so this
 * budget is only ever spent on a stall: a cold start, a connection storm, a
 * saturated web function. A cold start took 8.5-10.5s on idle preprod
 * deployments (measured 2026-11-27), so 8s failed the first request of every
 * deploy and the person saw a session error instead of a slow page. 12s covers
 * that and stays under the 20s the background chat reads allow
 * (`fetch-sidebar-room-collection.ts`).
 *
 * One constant for both callers. `auth.server.ts` reads the session directly
 * and `auth.server.client.ts` drives the Better Auth client; they held separate
 * numbers under the same name, and raising one left the other behind.
 */
export const CORE_AUTH_REQUEST_TIMEOUT_MS = 12_000;
