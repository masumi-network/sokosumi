# Core HTTP logging uses evlog wide events

Core had Sentry plus Hono's unstructured `logger()`, and no queryable per-request log. We adopted evlog on Core HTTP only: one wide event per request, identity from auth/workspace middleware, stdout (pretty locally, JSON in production). Web stays on Sentry. The public error envelope (`error` / `message` / `kind` / `meta.requestId`) is unchanged.

## Considered Options

- pino — boring, no wide events, another HTTP helper to assemble.
- evlog on Core and Web in one change — Web is a thin client; client ingest and `withEvlog` on every route/action is a second project.
- Domain `log.set` on every Core handler — hundreds of files before we know the event shape is useful.

Chose Core middleware + identity enrichers. Domain `log.set` on hot paths waits until request events are in use.

Web does not run evlog. It forwards `X-Request-Id` on Core client calls (and the chat proxy). Core's `requestId()` reuses that header, so Web errors and Core wide events share one id.

When `SENTRY_DSN` is set, the same wide events also drain to Sentry Logs (`createSentryDrain`). Stdout stays. The Sentry SDK still owns exceptions and traces.

`evlog/better-auth` is not a Better Auth `plugins[]` entry and does not emit sign-in/sign-up events. Cookie sessions call `identifyUser` on the session we already loaded (`maskEmail: true`). We do not call `createAuthMiddleware` — that would `getSession` a second time. API keys, coworker keys, and the orchestrator token stay on the existing actor/id enrichers.
