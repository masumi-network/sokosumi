"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useSession } from "@/lib/auth/auth.client";
import { isSessionNotFreshError } from "@/lib/auth/session-freshness";

/**
 * Marks the action a viewer was performing when Better Auth rejected their
 * session as stale. The social path leaves the page for the provider, so the
 * intent has to outlive the redirect.
 */
const PENDING_ACTION_STORAGE_KEY = "sokosumi.reauth.pendingAction";

interface PendingAction {
  actionKey: string;
  /** When the redirect started, to tell a new session from the old one. */
  startedAt: number;
}

function readPendingAction(): null | PendingAction {
  try {
    const raw = window.sessionStorage.getItem(PENDING_ACTION_STORAGE_KEY);

    if (raw === null) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("actionKey" in parsed) ||
      typeof parsed.actionKey !== "string" ||
      !("startedAt" in parsed) ||
      typeof parsed.startedAt !== "number"
    ) {
      return null;
    }

    return { actionKey: parsed.actionKey, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

function writePendingAction(actionKey: string): void {
  try {
    window.sessionStorage.setItem(
      PENDING_ACTION_STORAGE_KEY,
      JSON.stringify({ actionKey, startedAt: Date.now() }),
    );
  } catch {
    // A blocked store only costs the automatic resume, so carry on.
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
  /** True when the viewer has a password or a linked social provider. */
  canReauthenticate: boolean;
  /** Runs when re-authentication succeeds, to repeat the rejected action. */
  onReauthenticated: () => void;
  /**
   * True when the action calls a browser API that needs a user gesture, such
   * as WebAuthn. Such an action cannot resume from an effect, so the viewer
   * is asked to start it again instead.
   */
  resumeNeedsUserGesture?: boolean;
}

interface ReauthGate {
  /**
   * Call with a failed result's error. Returns true when the error was a stale
   * session and this hook has taken over, so the caller should stop.
   */
  handleError: (error: unknown) => boolean;
  isOpen: boolean;
  /** Pass to the dialog's `onBeforeRedirect`. */
  rememberPendingAction: () => void;
  /** Pass to the dialog's `onReauthenticated`. */
  retry: () => void;
  /** Pass to the dialog's `onOpenChange`. */
  setIsOpen: (open: boolean) => void;
}

/**
 * Shared handling for a route that Better Auth gates on session freshness.
 *
 * One retry only. A second stale rejection means re-authentication did not
 * take, so the caller reports its own error rather than looping on the dialog.
 */
export function useReauthGate({
  actionKey,
  canReauthenticate,
  onReauthenticated,
  resumeNeedsUserGesture = false,
}: UseReauthGateOptions): ReauthGate {
  const t = useTranslations("Components.ReauthDialog");
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const hasRetried = useRef(false);
  const hasResumed = useRef(false);

  useEffect(() => {
    if (hasResumed.current) {
      return;
    }

    const pending = readPendingAction();

    if (pending?.actionKey !== actionKey) {
      return;
    }

    const createdAt = session?.session.createdAt;

    if (createdAt === undefined) {
      // The session is still loading; this effect runs again once it lands.
      return;
    }

    hasResumed.current = true;
    clearPendingAction();

    // A cancelled or failed provider sign-in returns the viewer with their old
    // session, so only a newer session proves they authenticated again.
    if (new Date(createdAt).getTime() <= pending.startedAt) {
      return;
    }

    hasRetried.current = true;

    if (resumeNeedsUserGesture) {
      toast.info(t("resumePrompt"));
      return;
    }

    onReauthenticated();
  }, [actionKey, onReauthenticated, resumeNeedsUserGesture, session, t]);

  const handleError = useCallback(
    (error: unknown) => {
      if (!isSessionNotFreshError(error)) {
        return false;
      }

      if (hasRetried.current) {
        // Already re-authenticated once, so let the caller report the failure.
        return false;
      }

      if (!canReauthenticate) {
        toast.error(t("noMethod"));
        return true;
      }

      setIsOpen(true);
      return true;
    },
    [canReauthenticate, t],
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
