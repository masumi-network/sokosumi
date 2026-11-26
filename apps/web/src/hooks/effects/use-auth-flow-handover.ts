"use client";

import { useEffectEvent, useLayoutEffect } from "react";

import {
  takeSignInHandover,
  takeSignUpHandover,
} from "@/lib/auth/auth-email-hint";
import type { SignInMethod } from "@/lib/utils/last-used-auth-method";

export interface AuthFlowSignInHandover {
  email: string;
  method: SignInMethod;
  codeSentAt: number | null;
}

export interface AuthFlowSignUpHandover {
  email: string;
  codeSentAt: number | null;
}

/**
 * Consumes a one-shot sign-in or sign-up handover from `sessionStorage` in a
 * layout effect so step 2 opens before step 1 paints.
 */
export function useAuthFlowHandover({
  isSignIn,
  prefilledEmail,
  emailLocked,
  onSignInHandover,
  onSignUpHandover,
}: {
  isSignIn: boolean;
  prefilledEmail: string | undefined;
  emailLocked: boolean;
  onSignInHandover: (handover: AuthFlowSignInHandover) => void;
  onSignUpHandover: (handover: AuthFlowSignUpHandover) => void;
}): void {
  const applyHandover = useEffectEvent(() => {
    if (isSignIn) {
      // Register found an account and chose the method as Continue here
      // would. An invitation fixes the address, so only a hand-over for that
      // address counts; any other is discarded.
      const handover = takeSignInHandover();
      if (!handover) return;
      if (
        prefilledEmail &&
        handover.email.toLowerCase() !== prefilledEmail.toLowerCase()
      ) {
        return;
      }
      onSignInHandover({
        email: prefilledEmail ?? handover.email,
        method: handover.method,
        codeSentAt: handover.method === "code" ? handover.codeSentAt : null,
      });
    } else {
      // Log in found no account and emailed the code.
      if (emailLocked) return;
      const handover = takeSignUpHandover();
      if (!handover) return;
      onSignUpHandover({
        email: handover.email,
        codeSentAt: handover.codeSentAt,
      });
    }
  });

  useLayoutEffect(() => {
    applyHandover();
  }, []);
}
