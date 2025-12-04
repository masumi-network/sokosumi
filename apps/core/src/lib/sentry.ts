import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

/**
 * Initialize Sentry for error tracking and performance monitoring
 * Gracefully handles missing DSN for local development
 */
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;

  // Skip initialization if DSN is not provided (local development)
  if (!dsn) {
    console.log("[Sentry] DSN not provided, skipping initialization");
    return;
  }

  Sentry.init({
    dsn,
    sendDefaultPii: true,

    // Enable performance monitoring with 0.5% sampling rate (matches web app)
    // Adjust this value based on traffic volume and cost considerations
    tracesSampleRate: 0.005,

    // Enable profiling with same sample rate as traces
    profilesSampleRate: 0.005,

    // Add profiling integration for detailed performance data
    integrations: [nodeProfilingIntegration()],

    // Set to true for debugging Sentry configuration issues
    debug: false,
  });

  console.log(`[Sentry] Initialized`);
}
