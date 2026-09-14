import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

import { getEnv } from "../config/env.js";
import { getEnvSecrets, redactDeep } from "./secret-redaction.js";

export function initSentry() {
  const env = getEnv();

  if (!env.SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    sendDefaultPii: true,
    // Errors are never sampled. This is the SDK default, and it is written
    // out because the two rates below are not: at 0.005 a reader has every
    // reason to read an unset third rate as sampled too, and to answer a
    // question about a missing event with the sampler rather than with the
    // code that should have reported it. A defect that reports once per
    // damaged row, or once per outage, has nothing to spare.
    sampleRate: 1,
    tracesSampleRate: 0.005,
    profilesSampleRate: 0.005,
    integrations: [
      nodeProfilingIntegration(),
      // The auto server span is built from the node request before any
      // middleware runs, so its name and its url.full / http.url /
      // http.target attributes are the concrete path. Nothing downstream can
      // reach them: setTransactionName applies to error events only
      // (scopeData.js skips it when event.type is "transaction"), the
      // transaction name comes from the span, and beforeSend is never called
      // for transaction events. `sentryMiddleware` opens its own http.server
      // span named after the route template, which becomes the root instead.
      // Outgoing request spans and release sessions are unaffected; only the
      // incoming server span is dropped.
      Sentry.httpIntegration({ disableIncomingRequestSpans: true }),
      // The default RequestData integration attaches the raw request URL to
      // every event, and `sendDefaultPii: true` adds the request headers and
      // cookies with it. Paths carry capability tokens (share links, invite
      // links, password reset links) and the headers carry the Authorization
      // and Cookie values, so none of it may be sent. `sentryMiddleware`
      // already reports a redacted URL and redacted headers itself.
      Sentry.requestDataIntegration({
        include: {
          url: false,
          query_string: false,
          headers: false,
          cookies: false,
        },
      }),
    ],
    debug: false,
    // Last line of defence, not the first. Error text assembled from a far
    // side's response body can carry our own credential back to us: a gateway
    // that answers with the request headers echoed turns one upstream outage
    // into a key disclosed to a third party that retains it. Message,
    // exception values, and breadcrumbs are all covered by the walk.
    beforeSend: (event) => redactDeep(event, getEnvSecrets()),
  });
}
