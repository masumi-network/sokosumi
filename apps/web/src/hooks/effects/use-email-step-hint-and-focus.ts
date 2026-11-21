"use client";

import { useEffect, useEffectEvent } from "react";

import { takeAuthEmailHint } from "@/lib/auth/auth-email-hint";

interface EmailStepFormControl {
  getValues: (name: "email") => string;
  setValue: (name: "email", value: string) => void;
  setFocus: (name: "email") => void;
}

interface UseEmailStepHintAndFocusOptions {
  form: EmailStepFormControl;
  emailLocked: boolean;
  autoFocus: boolean;
  onEmailChange?: ((email: string) => void) | undefined;
}

/**
 * Consumes a one-shot auth email hint into `EmailStep`'s form on mount (or
 * React `<Activity>` reveal) and focuses the email field when requested or
 * populated from a hint.
 */
export function useEmailStepHintAndFocus({
  form,
  emailLocked,
  autoFocus,
  onEmailChange,
}: UseEmailStepHintAndFocusOptions): void {
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
    applyMountHintAndFocus();
  }, []);
}
