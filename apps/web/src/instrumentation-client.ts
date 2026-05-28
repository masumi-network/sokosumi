import * as Sentry from "@sentry/nextjs";

import {
  beforeSendThirdPartyClientErrorFilter,
  SENTRY_DENIED_THIRD_PARTY_SCRIPT_URLS,
  SENTRY_IGNORED_THIRD_PARTY_ERRORS,
} from "@/lib/sentry/third-party-error-filters";

Sentry.init({
  // eslint-disable-next-line no-restricted-properties
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  // sendDefaultPii: true,
  // TODO: Uncomment this when Sentry team fixed open issue
  // https://github.com/getsentry/sentry-javascript/issues/16542

  beforeSend: beforeSendThirdPartyClientErrorFilter,
  denyUrls: SENTRY_DENIED_THIRD_PARTY_SCRIPT_URLS,
  ignoreErrors: SENTRY_IGNORED_THIRD_PARTY_ERRORS,

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
});

// This export will instrument router navigations, and is only relevant if you enable tracing.
// `captureRouterTransitionStart` is available from SDK version 9.12.0 onwards
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
