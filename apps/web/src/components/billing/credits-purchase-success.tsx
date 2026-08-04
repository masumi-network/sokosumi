"use client";

import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { Suspense, useState } from "react";

import { PurchaseSuccessModal } from "@/components/billing/purchase-success-modal";
import type { CoworkerOption } from "@/lib/types/coworker";

interface CreditsPurchaseSuccessProps {
  coworkersPromise: Promise<CoworkerOption[]>;
  /** Seeded from the server-seen `session_id` so open state matches
   * SubscriptionSuccessModal (latch + clear marker on dismiss). */
  initialOpen?: boolean;
}

export function CreditsPurchaseSuccess(props: CreditsPurchaseSuccessProps) {
  return (
    <Suspense>
      <CreditsPurchaseSuccessInner {...props} />
    </Suspense>
  );
}

function CreditsPurchaseSuccessInner({
  coworkersPromise,
  initialOpen = false,
}: CreditsPurchaseSuccessProps) {
  const t = useTranslations("App.Billing.PurchaseSuccess");
  const [, setSessionId] = useQueryState("session_id");
  const [open, setOpen] = useState(initialOpen);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      void setSessionId(null);
    }
  }

  return (
    <PurchaseSuccessModal
      open={open}
      onOpenChange={handleOpenChange}
      headline={t("creditsTitle")}
      description={t("creditsDescription")}
      coworkersPromise={coworkersPromise}
    />
  );
}
