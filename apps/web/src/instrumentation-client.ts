import * as Sentry from "@sentry/nextjs";

import { shouldIgnoreClientError } from "@/lib/sentry/client-error-filter";

Sentry.init({
  // eslint-disable-next-line no-restricted-properties
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  // sendDefaultPii: true,
  // TODO: Uncomment this when Sentry team fixed open issue
  // https://github.com/getsentry/sentry-javascript/issues/16542

  integrations: [Sentry.replayIntegration({})],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 0.005,

  // Capture Replay for 1% of all sessions,
  // plus for 100% of sessions with an error
  // Learn more at
  // https://docs.sentry.io/platforms/javascript/session-replay/configuration/#general-integration-configuration
  replaysSessionSampleRate: 0.005,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  denyUrls: [
    /px\.ads\.linkedin\.com/i,
    /plausible\.io/i,
    /pagead2\.googlesyndication\.com/i,
    /google-analytics\.com/i,
    /web\.cmp\.usercentrics\.eu/i,
    /li\.lms-analytics/i,
  ],

  beforeSend(event, hint) {
    if (shouldIgnoreClientError(event, hint)) {
      return null;
    }
    return event;
  },
});

// This export will instrument router navigations, and is only relevant if you enable tracing.
// `captureRouterTransitionStart` is available from SDK version 9.12.0 onwards
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
