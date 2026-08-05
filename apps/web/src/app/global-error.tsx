"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useLayoutEffect, useState } from "react";

import {
  hasDeploymentRefreshGuard,
  isStaleDeploymentError,
  performDeploymentRefresh,
} from "@/lib/utils/deployment-refresh";

const nextErrorLayoutStyles = {
  error: {
    fontFamily:
      'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"',
    height: "100vh",
    textAlign: "center" as const,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
  },
  desc: {
    lineHeight: "48px",
  },
  h2: {
    fontSize: "0.875rem",
    fontWeight: 400,
    lineHeight: "28px",
    margin: 0,
  },
  wrap: {
    display: "inline-block",
  },
};

const nextErrorBodyStyles = `body{color:#000;background:#fff;margin:0}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}}`;

function applyStoredThemeToBody() {
  try {
    const theme = localStorage.getItem("theme");
    const isDark =
      theme === "dark" ||
      (theme !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    document.body.style.background = isDark ? "#000" : "#fff";
    document.body.style.color = isDark ? "#fff" : "#000";
  } catch {
    // localStorage may be unavailable
  }
}

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const [shouldReload, setShouldReload] = useState(false);

  useLayoutEffect(() => {
    applyStoredThemeToBody();
  }, []);

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
    <html lang="en">
      <body>
        <style dangerouslySetInnerHTML={{ __html: nextErrorBodyStyles }} />
        <div style={nextErrorLayoutStyles.error}>
          <div style={nextErrorLayoutStyles.desc}>
            <div style={nextErrorLayoutStyles.wrap}>
              <h2 style={nextErrorLayoutStyles.h2}>
                Application error: a client-side exception has occurred (see the
                browser console for more information).
              </h2>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
