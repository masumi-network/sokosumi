// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // eslint-disable-next-line no-restricted-properties
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  // sendDefaultPii: true,
  // TODO: Uncomment this when Sentry team fixed open issue
  // https://github.com/getsentry/sentry-javascript/issues/16542

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 0.005,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
