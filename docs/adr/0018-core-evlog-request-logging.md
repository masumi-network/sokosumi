# Core HTTP logging uses evlog wide events

Core had Sentry plus Hono's unstructured `logger()`, and no queryable per-request log. We adopted evlog on Core HTTP only: one wide event per request, identity from auth/workspace middleware, stdout (pretty locally, JSON in production). Web stays on Sentry. The public error envelope (`error` / `message` / `kind` / `meta.requestId`) is unchanged.

## Considered Options

- pino — boring, no wide events, another HTTP helper to assemble.
- evlog on Core and Web in one change — Web is a thin client; client ingest and `withEvlog` on every route/action is a second project.
- Domain `log.set` on every Core handler — hundreds of files before we know the event shape is useful.

Chose Core middleware + identity enrichers. Domain fields and a Sentry Logs drain wait until request events are in use.
