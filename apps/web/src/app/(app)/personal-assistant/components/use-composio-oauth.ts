"use client";

import * as Sentry from "@sentry/nextjs";
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
/** Poll only when `readPopupClosed` can return `true` (not COOP-blocked `null`). */
const POPUP_POLL_INTERVAL_MS = 500;
const SENTRY_CONTEXT = "composio_oauth";

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

function addOAuthBreadcrumb(
  message: string,
  data: {
    provider: HermesIntegrationProvider;
    mode: HermesIntegrationMode;
  } & Record<string, unknown>,
): void {
  Sentry.addBreadcrumb({
    category: SENTRY_CONTEXT,
    message,
    level: "info",
    data,
  });
}

function captureOAuthFailure(
  reason:
    | "popup_blocked"
    | "initiate_failed"
    | "timeout"
    | "callback_error"
    | "finalize_failed"
    | "popup_closed",
  data: {
    provider: HermesIntegrationProvider;
    mode: HermesIntegrationMode;
  } & Record<string, unknown>,
): void {
  Sentry.captureMessage(`composio_oauth_${reason}`, {
    level: "warning",
    tags: {
      context: SENTRY_CONTEXT,
      reason,
      provider: data.provider,
      mode: data.mode,
    },
    extra: data,
  });
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
 *   3. Listen for callback (BroadcastChannel + postMessage), popup close, or timeout.
 *      On close without callback, attempt recovery finalize (server polls Composio).
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
  const pollerRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (messageHandlerRef.current) {
      window.removeEventListener("message", messageHandlerRef.current);
      messageHandlerRef.current = null;
    }
    broadcastRef.current?.close();
    broadcastRef.current = null;
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
      const popup = window.open(
        "about:blank",
        "composio-oauth",
        POPUP_FEATURES,
      );
      if (!popup) {
        captureOAuthFailure("popup_blocked", { provider, mode });
        return { ok: false, reason: "popup_blocked" };
      }
      popupRef.current = popup;
      addOAuthBreadcrumb("popup opened", { provider, mode });

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
        captureOAuthFailure("initiate_failed", {
          provider,
          mode,
          message: initiate.error.message ?? null,
        });
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

      const result = await new Promise<
        | { kind: "callback"; payload: CallbackResult }
        | { kind: "closed" }
        | { kind: "timeout" }
      >((resolve) => {
        let settled = false;

        const finish = (
          value:
            | { kind: "callback"; payload: CallbackResult }
            | { kind: "closed" }
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
          addOAuthBreadcrumb("callback received", {
            provider,
            mode,
            status: payload.status,
            hasConnectionId: payload.connectionId !== null,
            hasError: payload.errorMessage !== null,
          });
          sendCallbackAck(ackTarget);
          finish({ kind: "callback", payload });
        };

        const onMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) {
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

        // COOP may block `popup.closed` on third-party OAuth pages — use
        // readPopupClosed so we only resolve "closed" on an explicit `true`,
        // not on blocked access (`null`). When the popup closes without a
        // callback (race, BroadcastChannel miss, user dismiss after OAuth),
        // attempt recovery finalize with the initiate connectionId.
        pollerRef.current = window.setInterval(() => {
          if (readPopupClosed(popup) === true) {
            finish({ kind: "closed" });
          }
        }, POPUP_POLL_INTERVAL_MS);

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
        captureOAuthFailure("timeout", { provider, mode });
        return { ok: false, reason: "timeout" };
      }

      if (result.kind === "closed") {
        addOAuthBreadcrumb("popup closed without callback, recovery finalize", {
          provider,
          mode,
        });
        const recovery = await finalizeHermesIntegrationAction({
          provider,
          connectionId,
          mode,
        });
        if (recovery.ok) {
          addOAuthBreadcrumb("recovery finalize succeeded", {
            provider,
            mode,
            integrationProvider: recovery.data.provider,
          });
          return { ok: true, integration: recovery.data };
        }
        captureOAuthFailure("popup_closed", {
          provider,
          mode,
          message: recovery.error.message ?? null,
        });
        return {
          ok: false,
          reason: "popup_closed",
          message: recovery.error.message ?? undefined,
        };
      }

      if (result.payload.status === "error") {
        captureOAuthFailure("callback_error", {
          provider,
          mode,
          message: result.payload.errorMessage,
          hasConnectionId: result.payload.connectionId !== null,
        });
        return {
          ok: false,
          reason: "error",
          message: result.payload.errorMessage ?? "Composio reported an error",
        };
      }

      const finalConnectionId = result.payload.connectionId ?? connectionId;

      const finalize = await finalizeHermesIntegrationAction({
        provider,
        connectionId: finalConnectionId,
        mode,
      });
      if (!finalize.ok) {
        captureOAuthFailure("finalize_failed", {
          provider,
          mode,
          message: finalize.error.message ?? null,
        });
        return {
          ok: false,
          reason: "error",
          message: finalize.error.message ?? undefined,
        };
      }

      addOAuthBreadcrumb("finalize succeeded", {
        provider,
        mode,
        integrationProvider: finalize.data.provider,
      });
      return { ok: true, integration: finalize.data };
    },
    [cleanup],
  );

  return { start };
}
