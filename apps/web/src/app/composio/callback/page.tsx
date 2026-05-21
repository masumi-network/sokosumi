"use client";

import { useEffect, useState } from "react";

/**
 * Composio redirects the user's browser here after they finish OAuth in the
 * popup. We read the result from the URL, postMessage it back to the opener
 * window (the Hermes onboarding screen / settings panel), and close.
 *
 * The page intentionally lives outside `(app)` so it isn't behind any auth
 * gate — the popup may have lost the parent's session cookies (rare, but
 * cheap insurance).
 */
const MESSAGE_TYPE = "sokosumi:composio:result" as const;

type Status = "success" | "error";

function readResult(): {
  status: Status;
  connectionId: string | null;
  errorMessage: string | null;
} {
  if (typeof window === "undefined") {
    return { status: "error", connectionId: null, errorMessage: null };
  }
  const params = new URLSearchParams(window.location.search);
  const rawStatus = (params.get("status") ?? "").toLowerCase();
  const connectionId =
    params.get("connectedAccountId") ??
    params.get("connected_account_id") ??
    params.get("connectionId") ??
    params.get("id");
  const errorMessage = params.get("error") ?? params.get("error_description");

  const status: Status =
    rawStatus === "success" || rawStatus === "active" || connectionId
      ? "success"
      : "error";

  return { status, connectionId, errorMessage };
}

export default function ComposioCallbackPage() {
  const [state, setState] = useState<{
    status: Status;
    posted: boolean;
  }>({ status: "success", posted: false });

  useEffect(() => {
    const result = readResult();

    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(
          {
            type: MESSAGE_TYPE,
            status: result.status,
            connectionId: result.connectionId,
            errorMessage: result.errorMessage,
          },
          window.location.origin,
        );
      } catch {
        // The opener may be on a different origin in dev; swallow and let the
        // page render the manual-close fallback below.
      }
    }

    setState({ status: result.status, posted: true });

    // Give the opener a tick to read the message before we close.
    const closeTimer = window.setTimeout(() => {
      try {
        window.close();
      } catch {
        /* popups opened with `noopener` cannot close themselves */
      }
    }, 250);

    return () => window.clearTimeout(closeTimer);
  }, []);

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-6 font-mono">
      <div className="text-center">
        <div className="text-tertiary-foreground mb-3 text-[11px] uppercase tracking-[0.18em]">
          composio · callback
        </div>
        <div className="text-foreground text-lg">
          {state.status === "success"
            ? "connection received"
            : "connection failed"}
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          {state.posted
            ? "you can close this window."
            : "finalizing…"}
        </p>
      </div>
    </main>
  );
}
