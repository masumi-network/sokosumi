# A revoked session passes until the cookie cache expires

- Status: Accepted
- Date: 2026-11-17

Core turns on Better Auth's `session.cookieCache` in `apps/core/src/lib/auth.ts`. Its lifetime is `BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE` in `apps/core/src/config/env.ts`, 300 seconds by default. While the cache is fresh, Better Auth reads the session from the signed cookie and does not look up the `session` row. So a revoked session keeps passing until its cache expires. We accept this window.

## Decisions

- **The window stays.** It is bounded by the cache lifetime, which is about as long as a normal access token lives.
- **The lever is the env value.** When the window must shrink, lower `BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE` (for example to 60). Do not add code for it.

## Considered Options

- **A `cookieCache.version` function that reads the database.** It closes the window, but every cached request then costs one database read, which removes most of what the cache saves.
- **A `sessionsValidAfter` column checked on each request.** The same cost for the same reason.

## Consequences

- A security review that finds short, bounded revocation lag treats it as this accepted risk, unless a hard requirement appears.
- Every field the session carries has the same lag, so a Core write that does not re-sign the cookie (such as `PATCH /v1/users/{id}/preferences`) reaches `useSession()` only when the cache expires. The rule for writes the UI must show at once is in [auth](../agents/auth.md#session-cookie-cache).
