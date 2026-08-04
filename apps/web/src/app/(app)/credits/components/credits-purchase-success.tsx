"use client";

import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { Suspense } from "react";

import { PurchaseSuccessModal } from "@/components/billing/purchase-success-modal";
import type { CoworkerOption } from "@/lib/types/coworker";

interface CreditsPurchaseSuccessProps {
  coworkersPromise: Promise<CoworkerOption[]>;
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
}: CreditsPurchaseSuccessProps) {
  const t = useTranslations("App.Billing.PurchaseSuccess");
  const [sessionId, setSessionId] = useQueryState("session_id");

  return (
    <PurchaseSuccessModal
      open={!!sessionId}
      onOpenChange={(open) => {
        if (!open) setSessionId(null);
      }}
      headline={t("creditsTitle")}
      description={t("creditsDescription")}
      coworkersPromise={coworkersPromise}
    />
  );
}
