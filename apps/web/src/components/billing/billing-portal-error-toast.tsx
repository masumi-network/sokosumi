"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { useBillingPortalErrorToast } from "@/hooks/effects/use-billing-portal-error-toast";

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

  useBillingPortalErrorToast({
    generalMessage,
    unauthorizedMessage,
    pathname,
    router,
    searchParams,
  });

  return null;
}

export function BillingPortalErrorToast(props: BillingPortalErrorToastProps) {
  return (
    <Suspense fallback={null}>
      <BillingPortalErrorToastContent {...props} />
    </Suspense>
  );
}
