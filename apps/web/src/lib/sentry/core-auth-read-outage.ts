import * as Sentry from "@sentry/nextjs";

import type { CoreAuthReadError } from "@/lib/auth/auth.server";

export function reportCoreAuthReadOutage(
  error: CoreAuthReadError,
  message: string,
): void {
  Sentry.withScope((scope) => {
    scope.setTag("context", "core_auth_read");
    scope.setTag("path", error.path);
    scope.setTag("reason", error.reason);

    if (error.status !== undefined) {
      scope.setTag("http_status", String(error.status));
    }

    if (error.reason === "http") {
      const level =
        error.status !== undefined && error.status >= 500 ? "error" : "warning";
      Sentry.captureMessage(message, level);
      return;
    }

    Sentry.captureMessage(message, "error");
  });
}
