import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    console.log("[Sentry] DSN not provided, skipping initialization");
    return;
  }

  Sentry.init({
    dsn,
    sendDefaultPii: true,
    tracesSampleRate: 0.005,
    profilesSampleRate: 0.005,
    integrations: [nodeProfilingIntegration()],
    debug: false,
  });

  console.log(`[Sentry] Initialized`);
}
