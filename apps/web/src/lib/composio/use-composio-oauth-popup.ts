"use client";

import { useCallback, useRef } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  COMPOSIO_OAUTH_ACK_TYPE,
  type ComposioOAuthCallbackPayload,
  getComposioOAuthBroadcastChannelName,
  getComposioOAuthPopupName,
  isComposioOAuthCallbackPayload,
  readPopupClosed,
} from "@/lib/composio/oauth-popup-protocol";

const POPUP_FEATURES = "popup=yes,width=560,height=720,noopener=no";
const POPUP_POLL_INTERVAL_MS = 500;
const POPUP_TIMEOUT_MS = 5 * 60 * 1000;

export type ComposioOAuthPopupWaitResult =
  | { kind: "callback"; payload: ComposioOAuthCallbackPayload }
  | { kind: "closed" }
  | { kind: "timeout" }
  | { kind: "cancelled" };

export interface ComposioOAuthPopupFlow {
  navigate: (redirectUrl: string) => void;
  nonce: string;
  waitForCallback: () => Promise<ComposioOAuthPopupWaitResult>;
}

export type ComposioOAuthPopupRunResult<T> =
  | { kind: "completed"; value: T }
  | { kind: "in_flight" }
  | { kind: "popup_blocked" };

interface ActivePopupFlow {
  cancelled: boolean;
  cancelWait: (() => void) | null;
  nonce: string;
  popup: Window;
  waitPromise: Promise<ComposioOAuthPopupWaitResult> | null;
}

function closePopup(popup: Window): void {
  if (readPopupClosed(popup) === true) return;
  try {
    popup.close();
  } catch {
    // The OAuth provider may have isolated its browsing context.
  }
}

function sendCallbackAck(
  target: Window | MessageEventSource | null,
  nonce: string,
): void {
  if (!target || !("postMessage" in target)) return;
  try {
    (target as Window).postMessage(
      { type: COMPOSIO_OAUTH_ACK_TYPE, nonce },
      window.location.origin,
    );
  } catch {
    // The callback popup closes quickly, so acknowledgement is best effort.
  }
}

function waitForOAuthCallback(
  flow: ActivePopupFlow,
): Promise<ComposioOAuthPopupWaitResult> {
  if (flow.waitPromise) return flow.waitPromise;
  if (flow.cancelled) return Promise.resolve({ kind: "cancelled" });

  flow.waitPromise = new Promise((resolve) => {
    let settled = false;
    let channel: BroadcastChannel | null = null;
    let poller: number | null = null;
    let timeout: number | null = null;

    function cleanup(): void {
      window.removeEventListener("message", onMessage);
      channel?.close();
      if (poller !== null) {
        window.clearInterval(poller);
        poller = null;
      }
      if (timeout !== null) {
        window.clearTimeout(timeout);
        timeout = null;
      }
      if (flow.cancelWait === cancel) {
        flow.cancelWait = null;
      }
    }

    function settle(result: ComposioOAuthPopupWaitResult): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    function cancel(): void {
      settle({ kind: "cancelled" });
    }

    function handlePayload(
      payload: unknown,
      target: Window | MessageEventSource | null,
    ): void {
      if (
        !isComposioOAuthCallbackPayload(payload) ||
        payload.nonce !== flow.nonce
      ) {
        return;
      }
      sendCallbackAck(target, flow.nonce);
      settle({ kind: "callback", payload });
    }

    function onMessage(event: MessageEvent): void {
      if (event.origin !== window.location.origin) return;
      handlePayload(event.data, event.source);
    }

    window.addEventListener("message", onMessage);
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(
          getComposioOAuthBroadcastChannelName(flow.nonce),
        );
        channel.onmessage = (event: MessageEvent) => {
          handlePayload(event.data, flow.popup);
        };
      }
    } catch {
      channel?.close();
      channel = null;
    }
    poller = window.setInterval(() => {
      if (readPopupClosed(flow.popup) === true) {
        settle({ kind: "closed" });
      }
    }, POPUP_POLL_INTERVAL_MS);
    timeout = window.setTimeout(() => {
      settle({ kind: "timeout" });
    }, POPUP_TIMEOUT_MS);
    flow.cancelWait = cancel;
  });

  return flow.waitPromise;
}

/** Owns the browser-only lifecycle shared by Composio OAuth popup flows. */
export function useComposioOAuthPopup() {
  const activeFlowRef = useRef<ActivePopupFlow | null>(null);
  const inFlightRef = useRef(false);

  const cleanupFlow = useCallback((flow: ActivePopupFlow | null) => {
    if (!flow) return;
    flow.cancelled = true;
    flow.cancelWait?.();
    closePopup(flow.popup);
    if (activeFlowRef.current === flow) {
      activeFlowRef.current = null;
      inFlightRef.current = false;
    }
  }, []);

  useMountEffect(() => () => cleanupFlow(activeFlowRef.current));

  const runPopupOAuth = useCallback(
    async <T>(
      action: (flow: ComposioOAuthPopupFlow) => Promise<T>,
    ): Promise<ComposioOAuthPopupRunResult<T>> => {
      if (inFlightRef.current) return { kind: "in_flight" };

      const nonce = crypto.randomUUID();
      const popup = window.open(
        "about:blank",
        getComposioOAuthPopupName(nonce),
        POPUP_FEATURES,
      );
      if (!popup) return { kind: "popup_blocked" };

      const activeFlow: ActivePopupFlow = {
        cancelled: false,
        cancelWait: null,
        nonce,
        popup,
        waitPromise: null,
      };
      activeFlowRef.current = activeFlow;
      inFlightRef.current = true;

      try {
        const value = await action({
          nonce,
          navigate: (redirectUrl) => {
            if (activeFlowRef.current !== activeFlow || activeFlow.cancelled) {
              return;
            }
            try {
              popup.location.href = redirectUrl;
            } catch {
              popup.location.replace(redirectUrl);
            }
            popup.focus();
          },
          waitForCallback: () => waitForOAuthCallback(activeFlow),
        });
        return { kind: "completed", value };
      } finally {
        cleanupFlow(activeFlow);
      }
    },
    [cleanupFlow],
  );

  return { runPopupOAuth };
}
