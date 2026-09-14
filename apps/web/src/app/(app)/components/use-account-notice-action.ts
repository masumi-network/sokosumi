"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { getAccountNoticePath } from "@/app/components/account-notice-action";
import { useAccountNotice } from "@/contexts/account-notice-provider";

export function useAccountNoticeAction() {
  const { notice } = useAccountNotice();
  const router = useRouter();

  const handleAction = useCallback(() => {
    if (!notice) {
      return;
    }

    router.push(getAccountNoticePath(notice));
  }, [notice, router]);

  return { handleAction, notice };
}
