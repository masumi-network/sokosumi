"use client";

import { type RefObject, useEffect, useEffectEvent, useRef } from "react";

import { takeAuthEmailHint } from "@/lib/auth/auth-email-hint";

interface EmailStepFormControl {
  getValues: (name: "email") => string;
  setValue: (name: "email", value: string) => void;
  setFocus: (name: "email") => void;
}

interface UseEmailStepLifecycleOptions {
  form: EmailStepFormControl;
  emailLocked: boolean;
  autoFocus: boolean;
  onEmailChange?: ((email: string) => void) | undefined;
}

interface EmailStepLifecycle {
  mountedRef: RefObject<boolean>;
  pendingRef: RefObject<AbortController | null>;
}

/**
 * Owns `EmailStep`'s mount/unmount lifecycle: tracks mounted state, aborts any
 * in-flight request on unmount, and consumes a one-shot auth email hint and
 * initial focus on mount.
 */
export function useEmailStepLifecycle({
  form,
  emailLocked,
  autoFocus,
  onEmailChange,
}: UseEmailStepLifecycleOptions): EmailStepLifecycle {
  const mountedRef = useRef(false);
  const pendingRef = useRef<AbortController | null>(null);

  const applyMountHintAndFocus = useEffectEvent(() => {
    // The other page hands over the address the person typed there. It is a
    // starting value, not a locked one like an invitation's address.
    const emailHint = takeAuthEmailHint();
    const useHint =
      emailHint !== null && !emailLocked && !form.getValues("email").trim();
    if (useHint) {
      form.setValue("email", emailHint);
      onEmailChange?.(emailHint);
    }
    if (autoFocus || useHint) {
      form.setFocus("email");
    }
  });

  useEffect(() => {
    mountedRef.current = true;
    applyMountHintAndFocus();
    return () => {
      mountedRef.current = false;
      pendingRef.current?.abort();
    };
  }, []);

  return { mountedRef, pendingRef };
}
