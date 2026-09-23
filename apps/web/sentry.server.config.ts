// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

import { getEnvPublicConfig } from "@/config/env.public";
import { beforeSendServerEvent } from "@/lib/sentry/expected-request-errors";
import { redactResetPasswordToken } from "@/lib/sentry/reset-password-token-redaction";

Sentry.init({
  dsn: getEnvPublicConfig().NEXT_PUBLIC_SENTRY_DSN,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 0.005,

  beforeSend: beforeSendServerEvent,
  beforeSendTransaction: redactResetPasswordToken,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
