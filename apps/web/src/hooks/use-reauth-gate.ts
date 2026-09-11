"use client";

import type { Account } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { isSessionNotFreshError } from "@/lib/auth/session-freshness";
import { canReauthenticateWith } from "@/lib/auth/social-providers";

interface UseReauthGateOptions {
  /** The viewer's linked accounts, which decide what the dialog can offer. */
  accounts: Account[];
}

interface ReauthGate {
  /** Spread onto `<ReauthDialog />`, so no call site wires it by hand. */
  dialogProps: {
    accounts: Account[];
    onOpenChange: (open: boolean) => void;
    onReauthenticated: () => void;
    open: boolean;
  };
  /**
   * Call with a failed result's error. Returns true when the error was a stale
   * session and this hook has taken over, so the caller should stop.
   */
  handleError: (error: unknown) => boolean;
}

/**
 * Shared handling for a route that Better Auth gates on session freshness.
 *
 * The gate re-authenticates and then stops. It deliberately does not repeat
 * the rejected action: the social path leaves the page, so a resumed action
 * would run without the click that asked for it, and WebAuthn needs a user
 * gesture that a resumed call no longer carries. The viewer starts the action
 * again against a session that is now fresh.
 */
export function useReauthGate({ accounts }: UseReauthGateOptions): ReauthGate {
  const t = useTranslations("Components.ReauthDialog");
  const [isOpen, setIsOpen] = useState(false);

  const handleError = useCallback(
    (error: unknown) => {
      if (!isSessionNotFreshError(error)) {
        return false;
      }

      if (!canReauthenticateWith(accounts)) {
        toast.error(t("noMethod"));
        return true;
      }

      setIsOpen(true);
      return true;
    },
    [accounts, t],
  );

  const handleReauthenticated = useCallback(() => {
    toast.success(t("retryPrompt"));
  }, [t]);

  return {
    dialogProps: {
      accounts,
      onOpenChange: setIsOpen,
      onReauthenticated: handleReauthenticated,
      open: isOpen,
    },
    handleError,
  };
}
