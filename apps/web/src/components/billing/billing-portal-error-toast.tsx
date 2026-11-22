"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { toast } from "sonner";

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  return null;
}

export function BillingPortalErrorToast(props: BillingPortalErrorToastProps) {
  return (
    <Suspense fallback={null}>
      <BillingPortalErrorToastContent {...props} />
    </Suspense>
  );
}
