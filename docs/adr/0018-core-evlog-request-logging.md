# Core HTTP logging uses evlog wide events

Core had Sentry plus Hono's unstructured `logger()`, and no queryable per-request log. We adopted evlog on Core HTTP only: one wide event per request, identity from auth/workspace middleware, stdout (pretty locally, JSON in production). Web stays on Sentry. The public error envelope (`error` / `message` / `kind` / `meta.requestId`) is unchanged.

## Considered Options

- pino — boring, no wide events, another HTTP helper to assemble.
- evlog on Core and Web in one change — Web is a thin client; client ingest and `withEvlog` on every route/action is a second project.
- Domain `log.set` on every Core handler — hundreds of files before we know the event shape is useful.

Chose Core middleware + identity enrichers. Domain `log.set` on hot paths waits until request events are in use.

Web does not run evlog. It forwards `X-Request-Id` on Core client calls (and the chat proxy). Core's `requestId()` reuses that header, so Web errors and Core wide events share one id.

When `SENTRY_DSN` is set, Hono `evlog({ drain: createSentryDrain() })` sends the same wide events to Sentry Logs. Stdout stays. The Sentry SDK still owns exceptions and traces. Without a DSN the drain is omitted so local/tests do not log a missing-DSN error on every request.

`evlog/better-auth` is not a Better Auth `plugins[]` entry and does not emit sign-in/sign-up events. Core uses the documented Hono pattern: `createAuthMiddleware(auth)` after `evlog()`, with `exclude: ["/auth/**"]` (Sokosumi auth is `/auth`, not `/api/auth`) and `maskEmail: true`. Cookie-session routes therefore call `getSession` twice (evlog identify + Core `sessionMiddleware`); Better Auth cookie cache keeps that cheap. API keys, coworker keys, and the orchestrator token still use the actor/id enrichers.
