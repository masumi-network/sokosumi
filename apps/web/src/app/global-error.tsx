"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect, useState } from "react";

import {
  hasDeploymentRefreshGuard,
  isStaleDeploymentError,
  performDeploymentRefresh,
} from "@/lib/utils/deployment-refresh";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const [shouldReload, setShouldReload] = useState(false);

  useEffect(() => {
    const message = error?.message ?? "";
    if (isStaleDeploymentError(message) && !hasDeploymentRefreshGuard()) {
      performDeploymentRefresh();
      return;
    }
    if (!isStaleDeploymentError(message)) {
      Sentry.captureException(error);
    }
    const id = setTimeout(() => setShouldReload(true), 0);
    return () => clearTimeout(id);
  }, [error]);

  if (!shouldReload && isStaleDeploymentError(error?.message ?? "")) {
    return null;
  }

  return (
    <html>
      <body>
        {/* `NextError` is the default Next.js error page component. Its type
        definition requires a `statusCode` prop. However, since the App Router
        does not expose status codes for errors, we simply pass 0 to render a
        generic error message. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
