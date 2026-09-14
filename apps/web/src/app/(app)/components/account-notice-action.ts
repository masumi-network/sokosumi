"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { toast } from "sonner";

import type { AccountNotice } from "@/app/components/account-notice-state";
import type { AuthCaptcha } from "@/components/auth-captcha-provider";
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

export async function performAccountNoticeAction(
  notice: AccountNotice,
  options: {
    router: AppRouterInstance;
    captcha: AuthCaptcha;
    emailMessages: AccountNoticeEmailMessages;
  },
): Promise<void> {
  if (notice.type === "emailVerification") {
    await sendAccountVerificationEmail(
      notice.email,
      options.emailMessages,
      options.captcha,
    );
    return;
  }

  options.router.push(notice.path);
}
