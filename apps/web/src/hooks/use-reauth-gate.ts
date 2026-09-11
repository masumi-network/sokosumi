"use client";

import { useCallback, useRef, useState } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { isSessionNotFreshError } from "@/lib/auth/session-freshness";

/**
 * Marks the action a viewer was performing when Better Auth rejected their
 * session as stale. The social path leaves the page for the provider, so the
 * intent has to outlive the redirect.
 */
const PENDING_ACTION_STORAGE_KEY = "sokosumi.reauth.pendingAction";

function readPendingAction(): null | string {
  try {
    return window.sessionStorage.getItem(PENDING_ACTION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writePendingAction(actionKey: string): void {
  try {
    window.sessionStorage.setItem(PENDING_ACTION_STORAGE_KEY, actionKey);
  } catch {
    // A blocked store only costs the automatic retry, so carry on.
  }
}

function clearPendingAction(): void {
  try {
    window.sessionStorage.removeItem(PENDING_ACTION_STORAGE_KEY);
  } catch {
    // Nothing to clean up when the store is unavailable.
  }
}

interface UseReauthGateOptions {
  /** Stable id for the action, so only its own caller resumes it. */
  actionKey: string;
  /** Runs when re-authentication succeeds, to repeat the rejected action. */
  onReauthenticated: () => void;
  /** Runs when the viewer owns no method this dialog can offer. */
  onUnavailable: () => void;
  /** True when the viewer has a password or a linked social provider. */
  canReauthenticate: boolean;
}

interface ReauthGate {
  /**
   * Call with a failed result's error. Returns true when the error was a stale
   * session and this hook has taken over, so the caller should stop.
   */
  handleError: (error: unknown) => boolean;
  isOpen: boolean;
  /** Pass to the dialog's `onOpenChange`. */
  setIsOpen: (open: boolean) => void;
  /** Pass to the dialog's `onBeforeRedirect`. */
  rememberPendingAction: () => void;
  /** Pass to the dialog's `onReauthenticated`. */
  retry: () => void;
}

/**
 * Shared handling for a route that Better Auth gates on session freshness.
 *
 * One retry only. A second stale rejection means re-authentication did not
 * take, and reopening the dialog would loop.
 */
export function useReauthGate({
  actionKey,
  canReauthenticate,
  onReauthenticated,
  onUnavailable,
}: UseReauthGateOptions): ReauthGate {
  const [isOpen, setIsOpen] = useState(false);
  const hasRetried = useRef(false);

  useMountEffect(() => {
    if (readPendingAction() !== actionKey) {
      return;
    }

    clearPendingAction();
    hasRetried.current = true;
    onReauthenticated();
  });

  const handleError = useCallback(
    (error: unknown) => {
      if (!isSessionNotFreshError(error)) {
        return false;
      }

      if (hasRetried.current || !canReauthenticate) {
        onUnavailable();
        return true;
      }

      setIsOpen(true);
      return true;
    },
    [canReauthenticate, onUnavailable],
  );

  const retry = useCallback(() => {
    hasRetried.current = true;
    onReauthenticated();
  }, [onReauthenticated]);

  const rememberPendingAction = useCallback(() => {
    writePendingAction(actionKey);
  }, [actionKey]);

  return {
    handleError,
    isOpen,
    rememberPendingAction,
    retry,
    setIsOpen,
  };
}
