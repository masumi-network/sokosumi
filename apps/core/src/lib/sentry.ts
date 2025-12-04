import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

import { getEnv } from "../config/env.js";

export function initSentry() {
  const env = getEnv();

  if (!env.SENTRY_DSN) {
    console.log("[Sentry] DSN not provided, skipping initialization");
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
  });

  console.log(`[Sentry] Initialized`);
}
