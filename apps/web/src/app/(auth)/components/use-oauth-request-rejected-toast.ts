"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { isRejectedOAuthRequestError } from "@/lib/auth/auth.utils";

/**
 * The auth client adds the page's OAuth request to every call, and Core
 * refuses the call when that request is stale. The returned check says so in
 * a toast, and tells the caller it did.
 */
export function useOAuthRequestRejectedToast(): (error: unknown) => boolean {
  const t = useTranslations("Auth.OAuthHandBack");
  return (error) => {
    if (!isRejectedOAuthRequestError(error)) return false;
    toast.error(t("errorDescription"));
    return true;
  };
}
