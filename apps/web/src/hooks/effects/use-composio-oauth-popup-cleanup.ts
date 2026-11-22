"use client";

import { type RefObject, useCallback, useEffect } from "react";

import type { ComposioOAuthPopupWaitResult } from "@/lib/composio/use-composio-oauth-popup";

export interface ActiveComposioPopupFlow {
  cancelled: boolean;
  cancelWait: (() => void) | null;
  nonce: string;
  popup: Window;
  waitPromise: Promise<ComposioOAuthPopupWaitResult> | null;
}

function closePopup(popup: Window): void {
  try {
    popup.close();
  } catch {
    // The OAuth provider may have isolated its browsing context.
  }
}

/**
 * Tears down any open Composio OAuth popup and listener when
 * `useComposioOAuthPopup` unmounts or hides, returning the shared `cleanupFlow`
 * handler for caller-managed teardown.
 */
export function useComposioOAuthPopupCleanup(
  activeFlowRef: RefObject<ActiveComposioPopupFlow | null>,
  inFlightRef: RefObject<boolean>,
) {
  const cleanupFlow = useCallback((flow: ActiveComposioPopupFlow | null) => {
    if (!flow) return;
    flow.cancelled = true;
    flow.cancelWait?.();
    closePopup(flow.popup);
    if (activeFlowRef.current === flow) {
      activeFlowRef.current = null;
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => () => cleanupFlow(activeFlowRef.current), []);

  return cleanupFlow;
}
