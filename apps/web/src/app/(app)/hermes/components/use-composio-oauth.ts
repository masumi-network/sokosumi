"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  finalizeHermesIntegrationAction,
  initiateHermesIntegrationAction,
} from "@/lib/actions/hermes";
import {
  COMPOSIO_OAUTH_ACK_TYPE,
  COMPOSIO_OAUTH_BROADCAST_CHANNEL,
  isComposioOAuthCallbackPayload,
  readPopupClosed,
} from "@/lib/composio/oauth-popup-protocol";
import type {
  HermesIntegration,
  HermesIntegrationMode,
  HermesIntegrationProvider,
} from "@/lib/hermes/types";

const POPUP_FEATURES = "popup=yes,width=560,height=720,noopener=no";
const POPUP_TIMEOUT_MS = 5 * 60 * 1000;
const LOG_PREFIX = "[composio-oauth]";

export type ComposioOAuthResult =
  | { ok: true; integration: HermesIntegration }
  | {
      ok: false;
      reason: "popup_blocked" | "popup_closed" | "timeout" | "error";
      message?: string;
    };

interface CallbackResult {
  connectionId: string | null;
  status: "success" | "error";
  errorMessage: string | null;
}

function parseCallbackPayload(data: unknown): CallbackResult | null {
  if (!isComposioOAuthCallbackPayload(data)) return null;
  return {
    connectionId: data.connectionId,
    status: data.status,
    errorMessage: data.errorMessage,
  };
}

function sendCallbackAck(target: Window | MessageEventSource | null): void {
  if (!target || !("postMessage" in target)) return;
  try {
    (target as Window).postMessage(
      { type: COMPOSIO_OAUTH_ACK_TYPE },
      window.location.origin,
    );
  } catch {
    /* popup may already be closing — best-effort */
  }
}

/**
 * Runs the Composio popup OAuth flow for a provider end-to-end.
 *
 *   1. Server-side `initiate` call → returns Composio redirect URL + connectionId.
 *   2. Open the URL in a popup window.
 *   3. Listen for the callback page (BroadcastChannel + postMessage) or timeout.
 *   4. Server-side `finalize` call → verifies + registers MCP with orchestrator.
 *
 * Returns a discriminated union so the caller can update its UI overlay
 * without re-implementing any of the OAuth state machine.
 */
export function useComposioOAuth() {
  const popupRef = useRef<Window | null>(null);
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(
    null,
  );
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (messageHandlerRef.current) {
      window.removeEventListener("message", messageHandlerRef.current);
      messageHandlerRef.current = null;
    }
    broadcastRef.current?.close();
    broadcastRef.current = null;
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
        popup.location.replace(redirectUrl);
      }
      popup.focus();

      // eslint-disable-next-line no-console
      console.log(LOG_PREFIX, "popup opened, waiting for callback", {
        provider,
        mode,
        connectionId,
      });

      const result = await new Promise<
        { kind: "callback"; payload: CallbackResult } | { kind: "timeout" }
      >((resolve) => {
        let settled = false;

        const finish = (
          value:
            | { kind: "callback"; payload: CallbackResult }
            | { kind: "timeout" },
        ) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        const onCallback = (
          payload: CallbackResult,
          ackTarget: Window | MessageEventSource | null,
        ) => {
          // eslint-disable-next-line no-console
          console.log(LOG_PREFIX, "accepted callback", {
            status: payload.status,
            hasConnectionId: payload.connectionId !== null,
            hasError: payload.errorMessage !== null,
          });
          sendCallbackAck(ackTarget);
          finish({ kind: "callback", payload });
        };

        const onMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) {
            // eslint-disable-next-line no-console
            console.warn(LOG_PREFIX, "rejected message from origin", {
              origin: event.origin,
              expected: window.location.origin,
            });
            return;
          }
          const payload = parseCallbackPayload(event.data);
          if (!payload) return;
          onCallback(payload, event.source);
        };
        messageHandlerRef.current = onMessage;
        window.addEventListener("message", onMessage);

        const channel = new BroadcastChannel(COMPOSIO_OAUTH_BROADCAST_CHANNEL);
        broadcastRef.current = channel;
        channel.onmessage = (event: MessageEvent) => {
          const payload = parseCallbackPayload(event.data);
          if (!payload) return;
          onCallback(payload, popup);
        };

        // Do not poll `popup.closed` while Composio is cross-origin — COOP
        // blocks the getter (console warning) and may lie about closed state.
        // Callback delivery uses BroadcastChannel + postMessage instead.

        timeoutRef.current = window.setTimeout(() => {
          finish({ kind: "timeout" });
        }, POPUP_TIMEOUT_MS);
      });

      cleanup();
      if (readPopupClosed(popup) === false) {
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

      if (result.payload.status === "error") {
        // eslint-disable-next-line no-console
        console.warn(LOG_PREFIX, "callback reported error", {
          errorMessage: result.payload.errorMessage,
        });
        return {
          ok: false,
          reason: "error",
          message: result.payload.errorMessage ?? "Composio reported an error",
        };
      }

      const finalConnectionId = result.payload.connectionId ?? connectionId;

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
