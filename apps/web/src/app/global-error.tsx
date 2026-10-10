"use client";

import { useEffect, useLayoutEffect, useState } from "react";

import {
  reportRouteError,
  shouldReportRouteError,
} from "@/lib/sentry/report-route-error";
import {
  hasDeploymentRefreshGuard,
  isStaleDeploymentError,
  performDeploymentRefresh,
} from "@/lib/utils/deployment-refresh";

const nextErrorBodyStyles = `
body{color:#000;background:#fff;margin:0;font-family:system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
@media (prefers-color-scheme:dark){body{color:#fff;background:#121212}}
.page{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:1.5rem}
.card{width:100%;max-width:28rem;padding:1.5rem;border:1px solid #e0e0e0;border-radius:0.75rem}
@media (prefers-color-scheme:dark){.card{border-color:#333}}
.card h1{font-size:1.125rem;font-weight:600;margin:0 0 0.5rem}
.card p{margin:0 0 0.5rem;opacity:0.7}
.actions{display:flex;flex-direction:column;gap:0.75rem;margin-top:1rem}
.actions button,.actions a{display:block;width:100%;padding:0.5rem 0.75rem;border-radius:0.375rem;font:inherit;text-align:center;text-decoration:none;cursor:pointer}
.actions button{border:0;background:#111;color:#fff}
@media (prefers-color-scheme:dark){.actions button{background:#fff;color:#111}}
.actions a{border:1px solid #e0e0e0;color:inherit}
@media (prefers-color-scheme:dark){.actions a{border-color:#333}}
`;

function applyStoredThemeToBody() {
  try {
    const theme = localStorage.getItem("theme");
    const isDark =
      theme === "dark" ||
      (theme !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    document.body.style.background = isDark ? "#121212" : "#fff";
    document.body.style.color = isDark ? "#fff" : "#000";
  } catch {
    // localStorage may be unavailable
  }
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
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
    reportRouteError(error);
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
        <div className="page">
          <div className="card">
            <h1>Something went wrong</h1>
            <p>Try again in a moment.</p>
            {shouldReportRouteError(error) ? (
              <p>Our team has been notified.</p>
            ) : null}
            <div className="actions">
              <button onClick={reset} type="button">
                Try again
              </button>
              <a href="/">Go to app</a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
