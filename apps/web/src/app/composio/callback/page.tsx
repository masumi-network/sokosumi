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
 *
 * Closing the popup is gated on an `ACK_TYPE` message from the opener so
 * we don't race the close ahead of the opener's `message` event listener
 * firing — that race was a suspect for the "no events on the orchestrator"
 * symptom. If the ack doesn't arrive within `CLOSE_FALLBACK_MS`, we close
 * anyway so a missing opener can't strand the popup.
 */
const MESSAGE_TYPE = "sokosumi:composio:result" as const;
const ACK_TYPE = "sokosumi:composio:ack" as const;
const CLOSE_FALLBACK_MS = 1500;
const LOG_PREFIX = "[composio-callback]";

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

  // An explicit failure or denial wins over the presence of a connectionId.
  // Some providers echo the in-flight connection id back even when they're
  // rejecting the grant (e.g. `?id=…&error=access_denied`); without this
  // check the opener kicks off finalize against a connection that will
  // never become ACTIVE and the user sees a confusing "not active yet"
  // error instead of "you denied access".
  const isExplicitFailure =
    rawStatus === "failed" ||
    rawStatus === "error" ||
    rawStatus === "expired" ||
    rawStatus === "inactive" ||
    Boolean(errorMessage);

  const status: Status = isExplicitFailure
    ? "error"
    : rawStatus === "success" || rawStatus === "active" || connectionId
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
    const openerAlive = Boolean(window.opener && !window.opener.closed);

    // eslint-disable-next-line no-console
    console.log(LOG_PREFIX, "loaded", {
      status: result.status,
      hasConnectionId: result.connectionId !== null,
      hasError: result.errorMessage !== null,
      openerAlive,
      origin: window.location.origin,
    });

    let closeTimer: number | null = null;
    const close = () => {
      try {
        window.close();
      } catch {
        /* popups opened with `noopener` cannot close themselves */
      }
    };
    const onAck = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (
        typeof event.data !== "object" ||
        event.data === null ||
        (event.data as { type?: unknown }).type !== ACK_TYPE
      ) {
        return;
      }
      // eslint-disable-next-line no-console
      console.log(LOG_PREFIX, "ack received, closing");
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      window.removeEventListener("message", onAck);
      close();
    };
    window.addEventListener("message", onAck);

    if (openerAlive) {
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
        // eslint-disable-next-line no-console
        console.log(LOG_PREFIX, "posted result to opener");
      } catch (err) {
        // The opener may be on a different origin in dev; swallow and let
        // the page render the manual-close fallback below.
        // eslint-disable-next-line no-console
        console.warn(LOG_PREFIX, "postMessage threw", err);
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn(LOG_PREFIX, "opener not alive — manual close required");
    }

    setState({ status: result.status, posted: true });

    // Fallback close: if the opener never acks (handler not registered,
    // tab navigated away, dev tools paused, …) we still self-destruct so
    // the user isn't stuck staring at the popup.
    closeTimer = window.setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn(LOG_PREFIX, "ack timeout, closing anyway");
      window.removeEventListener("message", onAck);
      close();
    }, CLOSE_FALLBACK_MS);

    return () => {
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      window.removeEventListener("message", onAck);
    };
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
          {state.posted ? "you can close this window." : "finalizing…"}
        </p>
      </div>
    </main>
  );
}
