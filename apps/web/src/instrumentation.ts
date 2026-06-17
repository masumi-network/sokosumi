/* eslint-disable no-restricted-properties */
import * as Sentry from "@sentry/nextjs";

import { isExpectedAuthRequestError } from "@/lib/sentry/expected-request-errors";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError: typeof Sentry.captureRequestError = (
  error,
  request,
  errorContext,
) => {
  if (isExpectedAuthRequestError(error)) {
    return;
  }

  Sentry.captureRequestError(error, request, errorContext);
};
