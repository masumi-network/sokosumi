"use client";

import { useEffect } from "react";

import { authClient } from "@/lib/auth/auth.client";

/**
 * Starts conditional WebAuthn passkey autofill when `showPasskey` is enabled
 * and the browser supports conditional mediation, ignoring late completions
 * after cleanup.
 */
export function useConditionalPasskeyAutofill(
  showPasskey: boolean | undefined,
  finishPasskeySignIn: (result: unknown) => Promise<void>,
): void {
  useEffect(() => {
    if (!showPasskey) {
      return;
    }

    if (
      typeof window === "undefined" ||
      typeof window.PublicKeyCredential === "undefined" ||
      typeof PublicKeyCredential.isConditionalMediationAvailable !== "function"
    ) {
      return;
    }

    let isMounted = true;

    const startConditionalPasskeySignIn = async () => {
      try {
        const isAvailable =
          await PublicKeyCredential.isConditionalMediationAvailable();
        if (!isMounted || !isAvailable) {
          return;
        }

        const result = await authClient.signIn.passkey({
          autoFill: true,
        });
        if (!isMounted || result.error) {
          return;
        }

        await finishPasskeySignIn(result.data);
      } catch {
        return undefined;
      }
    };

    void startConditionalPasskeySignIn();

    return () => {
      isMounted = false;
    };
  }, [finishPasskeySignIn, showPasskey]);
}
