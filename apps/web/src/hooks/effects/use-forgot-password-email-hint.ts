"use client";

import { useEffect, useEffectEvent } from "react";
import type { UseFormReturn } from "react-hook-form";

import { takeAuthEmailHint } from "@/lib/auth/auth-email-hint";
import type { EmailFormSchemaType } from "@/lib/schemas/auth";

/**
 * Consumes a one-shot email hint left by Sign-in in `sessionStorage` and fills
 * the Forgot Password email field on mount.
 */
export function useForgotPasswordEmailHint(
  form: Pick<UseFormReturn<EmailFormSchemaType>, "setValue">,
): void {
  const applyHint = useEffectEvent(() => {
    const emailHint = takeAuthEmailHint();
    if (emailHint) {
      form.setValue("email", emailHint);
    }
  });

  useEffect(() => {
    applyHint();
  }, []);
}
