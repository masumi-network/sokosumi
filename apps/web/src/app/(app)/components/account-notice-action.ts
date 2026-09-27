"use client";

import { toast } from "sonner";

import type { AccountNotice } from "@/app/components/account-notice-state";
import type { AuthCaptcha } from "@/components/auth-captcha";
import { authClient } from "@/lib/auth/auth.client";

interface AccountNoticeEmailMessages {
  sendError: string;
  sendSuccess: string;
}

export async function sendAccountVerificationEmail(
  email: string,
  messages: AccountNoticeEmailMessages,
  captcha: AuthCaptcha,
): Promise<void> {
  try {
    await captcha.runWithCaptcha(async (fetchOptions) => {
      const result = await authClient.sendVerificationEmail({
        email,
        fetchOptions,
        callbackURL: window.location.href,
      });

      if (result.error) {
        toast.error(
          captcha.getErrorMessage(
            result.error,
            result.error.message ?? messages.sendError,
          ),
        );
        return;
      }

      toast.success(messages.sendSuccess);
    });
  } catch {
    toast.error(messages.sendError);
  }
}

/**
 * Where a notice leads from surfaces that cannot host the security check
 * (toast, the bell panel). Email verification lands on the notifications
 * page, whose Needs you row carries the resend button and its inline check.
 * The toast switches the view to Needs you first (`useAccountNoticeAction`);
 * the panel only shows the row on Needs you, and the page shares its view.
 */
export function getAccountNoticePath(notice: AccountNotice): string {
  return notice.type === "emailVerification" ? "/notifications" : notice.path;
}
