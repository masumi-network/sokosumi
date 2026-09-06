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
    tracesSampleRate: 0.005,
    profilesSampleRate: 0.005,
    integrations: [nodeProfilingIntegration()],
    debug: false,
    // Last line of defence, not the first. Error text assembled from a far
    // side's response body can carry our own credential back to us: a gateway
    // that answers with the request headers echoed turns one upstream outage
    // into a key disclosed to a third party that retains it. Message,
    // exception values, and breadcrumbs are all covered by the walk.
    beforeSend: (event) => redactDeep(event, getEnvSecrets()),
  });
}
