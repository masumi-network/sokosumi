"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { useRouteNoticeToast } from "@/hooks/effects/use-route-notice-toast";
import {
  BILLING_PORTAL_ERROR_PARAM,
  BILLING_PORTAL_ERROR_UNAUTHORIZED,
} from "@/lib/billing/billing-portal-redirect";

interface BillingPortalErrorToastProps {
  generalMessage: string;
  unauthorizedMessage?: string;
}

function BillingPortalErrorToastContent({
  generalMessage,
  unauthorizedMessage,
}: BillingPortalErrorToastProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const errorCode = searchParams.get(BILLING_PORTAL_ERROR_PARAM);

  let replaceHref = pathname;
  if (errorCode) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete(BILLING_PORTAL_ERROR_PARAM);
    const query = nextParams.toString();
    replaceHref = query ? `${pathname}?${query}` : pathname;
  }

  useRouteNoticeToast(
    errorCode
      ? {
          variant: "error",
          message:
            errorCode === BILLING_PORTAL_ERROR_UNAUTHORIZED &&
            unauthorizedMessage
              ? unauthorizedMessage
              : generalMessage,
          replaceHref,
          once: true,
        }
      : null,
  );

  return null;
}

export function BillingPortalErrorToast(props: BillingPortalErrorToastProps) {
  return (
    <Suspense fallback={null}>
      <BillingPortalErrorToastContent {...props} />
    </Suspense>
  );
}
