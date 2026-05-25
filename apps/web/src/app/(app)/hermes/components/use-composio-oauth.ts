"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  finalizeHermesIntegrationAction,
  initiateHermesIntegrationAction,
} from "@/lib/actions/hermes";
import type {
  HermesIntegration,
  HermesIntegrationMode,
  HermesIntegrationProvider,
} from "@/lib/hermes/types";

const POPUP_FEATURES = "popup=yes,width=560,height=720,noopener=no";
const POPUP_TIMEOUT_MS = 5 * 60 * 1000;
const POPUP_POLL_INTERVAL_MS = 500;
const MESSAGE_TYPE = "sokosumi:composio:result" as const;
const ACK_TYPE = "sokosumi:composio:ack" as const;
const LOG_PREFIX = "[composio-oauth]";

interface CallbackMessage {
  type: typeof MESSAGE_TYPE;
  status: "success" | "error";
  connectionId: string | null;
  errorMessage: string | null;
}

export type ComposioOAuthResult =
  | { ok: true; integration: HermesIntegration }
  | {
      ok: false;
      reason: "popup_blocked" | "popup_closed" | "timeout" | "error";
      message?: string;
    };

function isCallbackMessage(value: unknown): value is CallbackMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === MESSAGE_TYPE
  );
}

/**
 * Runs the Composio popup OAuth flow for a provider end-to-end.
 *
 *   1. Server-side `initiate` call → returns Composio redirect URL + connectionId.
 *   2. Open the URL in a popup window.
 *   3. Listen for the callback page's `postMessage` (or popup close).
 *   4. Server-side `finalize` call → verifies + registers MCP with orchestrator.
 *
 * Returns a discriminated union so the caller can update its UI overlay
 * without re-implementing any of the OAuth state machine.
 */
export function useComposioOAuth() {
  // Track any in-flight popup so the hook can clean up on unmount.
  const popupRef = useRef<Window | null>(null);
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(
    null,
  );
  const pollerRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (messageHandlerRef.current) {
      window.removeEventListener("message", messageHandlerRef.current);
      messageHandlerRef.current = null;
    }
    if (pollerRef.current !== null) {
      window.clearInterval(pollerRef.current);
      pollerRef.current = null;
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    popupRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(
    async (
      provider: HermesIntegrationProvider,
      mode: HermesIntegrationMode = "read",
    ): Promise<ComposioOAuthResult> => {
      // Open the popup synchronously before the await so the user-gesture
      // chain from the originating click survives. If we wait until after
      // `initiateHermesIntegrationAction` returns the browser counts the
      // gesture as expired and blocks the popup.
      const popup = window.open(
        "about:blank",
        "composio-oauth",
        POPUP_FEATURES,
      );
      if (!popup) {
        return { ok: false, reason: "popup_blocked" };
      }
      popupRef.current = popup;

      const initiate = await initiateHermesIntegrationAction({
        provider,
        mode,
      });
      if (!initiate.ok) {
        try {
          popup.close();
        } catch {
          /* ignore */
        }
        return {
          ok: false,
          reason: "error",
          message: initiate.error.message ?? undefined,
        };
      }

      const { redirectUrl, connectionId } = initiate.data;
      try {
        popup.location.href = redirectUrl;
      } catch {
        // Cross-origin navigation race — fall back to a top-level open.
        popup.location.replace(redirectUrl);
      }
      popup.focus();

      // eslint-disable-next-line no-console
      console.log(LOG_PREFIX, "popup opened, waiting for callback", {
        provider,
        mode,
        connectionId,
      });

      // Race: callback message wins, popup close loses, timeout loses last.
      const result = await new Promise<
        | {
            kind: "message";
            connectionId: string | null;
            status: "success" | "error";
            errorMessage: string | null;
          }
        | { kind: "closed" }
        | { kind: "timeout" }
      >((resolve) => {
        const onMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) {
            // eslint-disable-next-line no-console
            console.warn(LOG_PREFIX, "rejected message from origin", {
              origin: event.origin,
              expected: window.location.origin,
            });
            return;
          }
          if (!isCallbackMessage(event.data)) return;
          // eslint-disable-next-line no-console
          console.log(LOG_PREFIX, "accepted callback message", {
            status: event.data.status,
            hasConnectionId: event.data.connectionId !== null,
            hasError: event.data.errorMessage !== null,
          });
          // Ack the popup so it can close immediately instead of waiting
          // out its 1.5s fallback timer.
          if (event.source && "postMessage" in event.source) {
            try {
              (event.source as Window).postMessage(
                { type: ACK_TYPE },
                window.location.origin,
              );
            } catch {
              /* popup may already be closing — best-effort */
            }
          }
          resolve({
            kind: "message",
            connectionId: event.data.connectionId,
            status: event.data.status,
            errorMessage: event.data.errorMessage,
          });
        };
        messageHandlerRef.current = onMessage;
        window.addEventListener("message", onMessage);

        pollerRef.current = window.setInterval(() => {
          if (popup.closed) resolve({ kind: "closed" });
        }, POPUP_POLL_INTERVAL_MS);

        timeoutRef.current = window.setTimeout(() => {
          resolve({ kind: "timeout" });
        }, POPUP_TIMEOUT_MS);
      });

      cleanup();
      if (!popup.closed) {
        try {
          popup.close();
        } catch {
          /* cross-origin window — ignore */
        }
      }

      if (result.kind === "timeout") {
        // eslint-disable-next-line no-console
        console.warn(LOG_PREFIX, "popup timeout");
        return { ok: false, reason: "timeout" };
      }

      // Popup-closed is not necessarily failure: some browsers race the
      // close event ahead of the callback's postMessage, and Composio may
      // have a valid ACTIVE connection waiting. Attempt finalize anyway —
      // the server-side poll will tell us whether the connection is real
      // (returns "popup_closed" only if finalize also rejects).
      if (result.kind === "closed") {
        // eslint-disable-next-line no-console
        console.log(
          LOG_PREFIX,
          "popup closed without message, attempting recovery finalize",
        );
        const recovery = await finalizeHermesIntegrationAction({
          provider,
          connectionId,
          mode,
        });
        if (recovery.ok) return { ok: true, integration: recovery.data };
        // eslint-disable-next-line no-console
        console.warn(LOG_PREFIX, "recovery finalize failed", {
          message: recovery.error.message,
        });
        return { ok: false, reason: "popup_closed" };
      }

      if (result.status === "error") {
        // eslint-disable-next-line no-console
        console.warn(LOG_PREFIX, "callback reported error", {
          errorMessage: result.errorMessage,
        });
        return {
          ok: false,
          reason: "error",
          message: result.errorMessage ?? "Composio reported an error",
        };
      }

      // Prefer the connection ID Composio echoed back; fall back to the one
      // initiate gave us (Composio sometimes omits it on the redirect).
      const finalConnectionId = result.connectionId ?? connectionId;

      // eslint-disable-next-line no-console
      console.log(LOG_PREFIX, "calling finalize", {
        provider,
        mode,
        connectionId: finalConnectionId,
      });
      const finalize = await finalizeHermesIntegrationAction({
        provider,
        connectionId: finalConnectionId,
        mode,
      });
      if (!finalize.ok) {
        // eslint-disable-next-line no-console
        console.warn(LOG_PREFIX, "finalize failed", {
          message: finalize.error.message,
        });
        return {
          ok: false,
          reason: "error",
          message: finalize.error.message ?? undefined,
        };
      }

      // eslint-disable-next-line no-console
      console.log(LOG_PREFIX, "finalize succeeded", {
        provider: finalize.data.provider,
      });
      return { ok: true, integration: finalize.data };
    },
    [cleanup],
  );

  return { start };
}
