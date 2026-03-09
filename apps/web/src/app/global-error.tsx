"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect, useState } from "react";

import {
  DEPLOYMENT_REFRESH_KEY,
  isChunkLoadError,
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
    if (
      isChunkLoadError(message) &&
      sessionStorage.getItem(DEPLOYMENT_REFRESH_KEY) !== "true"
    ) {
      performDeploymentRefresh();
      return;
    }
    if (!isChunkLoadError(message)) {
      Sentry.captureException(error);
    }
    const id = setTimeout(() => setShouldReload(true), 0);
    return () => clearTimeout(id);
  }, [error]);

  if (!shouldReload && isChunkLoadError(error?.message ?? "")) {
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
