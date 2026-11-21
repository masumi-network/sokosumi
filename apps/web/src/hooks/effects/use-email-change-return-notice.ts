"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/auth.client";

/** Marks the change link's return to this page; a refused link adds `error`. */
const EMAIL_CHANGE_PARAM = "emailChange";

interface UseEmailChangeReturnNoticeOptions {
  completedEmail: string | undefined;
  currentEmail: string | undefined;
  t: ReturnType<typeof useTranslations<"App.Account.Email">>;
}

/**
 * Handles the one-shot return from an email-change confirmation link: toasts
 * completion or failure, acknowledges completion in Core, and strips return
 * query parameters from the URL.
 */
export function useEmailChangeReturnNotice({
  completedEmail,
  currentEmail,
  t,
}: UseEmailChangeReturnNoticeOptions): void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const handledReturnRef = useRef(false);

  // Only Core's completion record says the change went through: the query
  // flag just marks a return from the link, where Better Auth adds `error`.
  useEffect(() => {
    if (handledReturnRef.current) return;
    const changedTo =
      completedEmail && completedEmail === currentEmail?.toLowerCase()
        ? completedEmail
        : null;
    const returned = searchParams.has(EMAIL_CHANGE_PARAM);
    if (!changedTo && !returned) return;
    handledReturnRef.current = true;
    if (changedTo) {
      toast.success(t("changed", { email: changedTo }));
      // An empty JSON body: Core answers a POST without one with 415.
      void authClient.$fetch("/email-change/acknowledge", {
        method: "POST",
        body: {},
      });
    } else if (searchParams.has("error")) {
      toast.error(t("linkFailed"));
    }
    if (returned) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete(EMAIL_CHANGE_PARAM);
      nextParams.delete("error");
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    }
  }, [completedEmail, currentEmail, pathname, router, searchParams, t]);
}
