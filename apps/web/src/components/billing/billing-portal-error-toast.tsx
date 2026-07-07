"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  BILLING_PORTAL_ERROR_GENERAL,
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasHandledRef = useRef(false);

  useEffect(() => {
    if (hasHandledRef.current) {
      return;
    }

    const errorCode = searchParams.get(BILLING_PORTAL_ERROR_PARAM);
    if (!errorCode) {
      return;
    }

    hasHandledRef.current = true;

    if (
      errorCode === BILLING_PORTAL_ERROR_UNAUTHORIZED &&
      unauthorizedMessage
    ) {
      toast.error(unauthorizedMessage);
    } else if (
      errorCode === BILLING_PORTAL_ERROR_GENERAL ||
      errorCode === BILLING_PORTAL_ERROR_UNAUTHORIZED
    ) {
      toast.error(generalMessage);
    } else {
      toast.error(generalMessage);
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete(BILLING_PORTAL_ERROR_PARAM);
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [generalMessage, pathname, router, searchParams, unauthorizedMessage]);

  return null;
}

export function BillingPortalErrorToast(props: BillingPortalErrorToastProps) {
  return (
    <Suspense fallback={null}>
      <BillingPortalErrorToastContent {...props} />
    </Suspense>
  );
}
