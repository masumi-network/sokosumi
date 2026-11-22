"use client";

import type { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  BILLING_PORTAL_ERROR_PARAM,
  BILLING_PORTAL_ERROR_UNAUTHORIZED,
} from "@/lib/billing/billing-portal-redirect";

export interface UseBillingPortalErrorToastOptions {
  generalMessage: string;
  unauthorizedMessage?: string;
  pathname: string;
  router: Pick<ReturnType<typeof useRouter>, "replace">;
  searchParams: Pick<ReturnType<typeof useSearchParams>, "get" | "toString">;
}

/**
 * Displays a one-shot toast when the billing portal redirects back with an
 * error query parameter, then strips the parameter from the URL.
 */
export function useBillingPortalErrorToast({
  generalMessage,
  unauthorizedMessage,
  pathname,
  router,
  searchParams,
}: UseBillingPortalErrorToastOptions): void {
  const handledErrorRef = useRef<string | null>(null);

  useEffect(() => {
    const errorCode = searchParams.get(BILLING_PORTAL_ERROR_PARAM);
    if (!errorCode) {
      handledErrorRef.current = null;
      return;
    }

    if (handledErrorRef.current === errorCode) {
      return;
    }

    handledErrorRef.current = errorCode;

    const message =
      errorCode === BILLING_PORTAL_ERROR_UNAUTHORIZED && unauthorizedMessage
        ? unauthorizedMessage
        : generalMessage;
    toast.error(message);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete(BILLING_PORTAL_ERROR_PARAM);
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [generalMessage, pathname, router, searchParams, unauthorizedMessage]);
}
