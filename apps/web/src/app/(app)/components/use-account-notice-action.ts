"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { performAccountNoticeAction } from "@/app/components/account-notice-action";
import { useAuthCaptcha } from "@/components/auth-captcha-provider";
import { useAccountNotice } from "@/contexts/account-notice-provider";

export function useAccountNoticeAction() {
  const { notice } = useAccountNotice();
  const router = useRouter();
  const captcha = useAuthCaptcha();
  const tEmail = useTranslations("App.EmailVerificationNotice");

  const handleAction = useCallback(async () => {
    if (!notice) {
      return;
    }

    await performAccountNoticeAction(notice, {
      emailMessages: {
        sendError: tEmail("sendError"),
        sendSuccess: tEmail("sendSuccess"),
      },
      router,
      captcha,
    });
  }, [notice, router, tEmail, captcha]);

  return { handleAction, notice };
}
