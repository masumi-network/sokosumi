"use client";

import { useCallback, useEffect, useRef } from "react";

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
 * Owns the active Composio OAuth popup flow refs and tears down any open popup
 * and listener when `useComposioOAuthPopup` unmounts or hides.
 */
export function useComposioOAuthPopupCleanup() {
  const activeFlowRef = useRef<ActiveComposioPopupFlow | null>(null);
  const inFlightRef = useRef(false);

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

  return { activeFlowRef, inFlightRef, cleanupFlow };
}
